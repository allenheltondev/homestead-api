import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { randomUUID } from "node:crypto";
import { ApiError, GrnNotConfiguredError, GrnUnauthorizedError } from "../services/errors.mjs";
import { logger } from "../services/logger.mjs";

// Good Roots Network (GRN) API client. This is the ONE place that talks to the
// upstream GRN service. It is intentionally optional: when GRN_API_BASE_URL or
// the SSM-stored bearer token is missing, every call throws a typed
// GrnNotConfiguredError so routes can 503 cleanly instead of erroring.
//
// Config:
//   GRN_API_BASE_URL        base URL of the GRN service (no trailing slash needed)
//   GRN_API_TOKEN_SSM_PATH  SSM SecureString path holding the bearer token
//
// The token is fetched from SSM with WithDecryption and cached in module scope
// for ~5 minutes so token rotation in SSM takes effect without a redeploy
// (the cache simply expires and the next call re-reads). All requests carry
// Authorization: Bearer <token>, X-Correlation-Id, and (when supplied by the
// caller) Idempotency-Key. Outbound calls use global fetch (Node 22) over the
// default Lambda networking, which has internet egress (no VPC).

const ssm = new SSMClient();

// Token cache TTL. SSM is the source of truth; a short cache balances rotation
// latency against not hitting SSM on every request.
const TOKEN_TTL_MS = 5 * 60 * 1000;

let cachedToken = null;
let cachedTokenExpiry = 0;

// Test-only hook to reset the module-scoped token cache between cases.
export function _resetTokenCache() {
  cachedToken = null;
  cachedTokenExpiry = 0;
}

function baseUrl() {
  const raw = process.env.GRN_API_BASE_URL;
  if (!raw || raw.trim().length === 0) return null;
  return raw.trim().replace(/\/+$/, "");
}

// Returns the bearer token, reading + caching it from SSM. Throws
// GrnNotConfiguredError when the SSM path is unset or the parameter is empty.
async function getToken() {
  const path = process.env.GRN_API_TOKEN_SSM_PATH;
  if (!path || path.trim().length === 0) {
    throw new GrnNotConfiguredError("GRN_API_TOKEN_SSM_PATH is not set");
  }

  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) {
    return cachedToken;
  }

  let value;
  try {
    const result = await ssm.send(new GetParameterCommand({
      Name: path.trim(),
      WithDecryption: true,
    }));
    value = result?.Parameter?.Value;
  } catch (err) {
    logger.error("GRN token fetch from SSM failed", { error: err?.message });
    throw new GrnNotConfiguredError("Good Roots Network token could not be read from SSM");
  }

  if (!value || value.trim().length === 0) {
    throw new GrnNotConfiguredError("Good Roots Network token in SSM is empty");
  }

  cachedToken = value.trim();
  cachedTokenExpiry = now + TOKEN_TTL_MS;
  return cachedToken;
}

// Whether the GRN integration is configured (base URL present). Used by
// best-effort callers (e.g. the daily alerts sync, the calendar enrichment) to
// skip silently when GRN isn't wired up.
export function isGrnConfigured() {
  return baseUrl() !== null
    && Boolean(process.env.GRN_API_TOKEN_SSM_PATH && process.env.GRN_API_TOKEN_SSM_PATH.trim());
}

// Core request helper. Builds the URL (path + optional query), attaches auth +
// correlation + idempotency headers, and maps upstream failures to typed
// errors:
//   401/403 -> GrnUnauthorizedError
//   other non-2xx -> ApiError carrying the upstream status (502)
// Returns the parsed JSON body (or null for 204/empty responses).
export async function grnRequest(method, path, {
  query,
  body,
  idempotencyKey,
  correlationId,
} = {}) {
  const base = baseUrl();
  if (!base) {
    throw new GrnNotConfiguredError("GRN_API_BASE_URL is not set");
  }

  const token = await getToken();

  let url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  if (query && typeof query === "object") {
    const qs = new URLSearchParams();
    for (const [key, val] of Object.entries(query)) {
      if (val !== undefined && val !== null && val !== "") qs.append(key, String(val));
    }
    const qsString = qs.toString();
    if (qsString) url += `?${qsString}`;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Correlation-Id": correlationId || randomUUID(),
    Accept: "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    logger.error("GRN request failed (network)", { method, path, error: err?.message });
    throw new ApiError(502, `Good Roots Network request failed: ${err?.message ?? "network error"}`, "GrnUpstream");
  }

  if (res.status === 401 || res.status === 403) {
    throw new GrnUnauthorizedError(res.status);
  }

  if (!res.ok) {
    const detail = await safeText(res);
    logger.error("GRN request non-ok", { method, path, status: res.status, detail });
    throw new ApiError(502, `Good Roots Network returned ${res.status}`, "GrnUpstream");
  }

  if (res.status === 204) return null;
  const text = await safeText(res);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

// --- High-level operations (mapped to the GRN OpenAPI contract) ---------
// Listing fields map to UpsertListingRequest (openapi/schemas/listings.yaml):
//   title, cropId (required uuid), varietyId?, quantityTotal (>0), unit,
//   availableStart, availableEnd, pickup*, contactPref, status.

// POST /listings — create a listing. Caller supplies the idempotency key
// (the harvest id) so a retried publish is safe.
export async function createListing(payload, { idempotencyKey, correlationId } = {}) {
  return grnRequest("POST", "/listings", { body: payload, idempotencyKey, correlationId });
}

// DELETE /listings/{id} — retire a listing. GRN has no explicit DELETE in the
// listing path set; updateListing flips status. We model "unpublish" as a PUT
// flipping status to expired (the closest contract operation).
export async function expireListing(listingId, payload, { correlationId } = {}) {
  return grnRequest("PUT", `/listings/${encodeURIComponent(listingId)}`, {
    body: { ...payload, status: "expired" },
    correlationId,
  });
}

// GET /my/listings — the caller's own listings (status/limit/offset filters).
export async function listMyListings({ status, limit, offset } = {}, { correlationId } = {}) {
  return grnRequest("GET", "/my/listings", { query: { status, limit, offset }, correlationId });
}

// GET /listings/discover — discover nearby listings. The contract keys
// discovery off a `geoKey` (+ radiusMiles); callers pass that through.
export async function discoverListings({ geoKey, radiusMiles, status, limit, offset } = {}, { correlationId } = {}) {
  return grnRequest("GET", "/listings/discover", {
    query: { geoKey, radiusMiles, status, limit, offset },
    correlationId,
  });
}

// GET /requests — open produce requests.
export async function listRequests({ limit, offset } = {}, { correlationId } = {}) {
  return grnRequest("GET", "/requests", { query: { limit, offset }, correlationId });
}

// POST /claims — claim a listing (CreateClaimRequest: listingId, requestId?,
// quantityClaimed (>0), notes?).
export async function createClaim(payload, { idempotencyKey, correlationId } = {}) {
  return grnRequest("POST", "/claims", { body: payload, idempotencyKey, correlationId });
}

// GET /claims?... — list claims (used to fetch a single claim by listing/req).
export async function listClaims({ listingId, requestId, status, limit, offset } = {}, { correlationId } = {}) {
  return grnRequest("GET", "/claims", {
    query: { listingId, requestId, status, limit, offset },
    correlationId,
  });
}

// GET /claims/{claimId} — fetch one claim. NOTE: the published GRN contract
// only documents PUT (transitionClaim) on this path; we issue a GET against it
// for read-after-create. If GRN rejects GET there it surfaces as an upstream
// error, which the route passes through.
export async function getClaim(claimId, { correlationId } = {}) {
  return grnRequest("GET", `/claims/${encodeURIComponent(claimId)}`, { correlationId });
}

// GET /catalog/crops — crop catalog (best-effort enrichment for the calendar).
export async function listCatalogCrops({ correlationId } = {}) {
  return grnRequest("GET", "/catalog/crops", { correlationId });
}
