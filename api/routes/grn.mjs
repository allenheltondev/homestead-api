import { jsonResponse, parseBody } from "../services/http.mjs";
import { publishEvent } from "../services/events.mjs";
import {
  validateMyListingsQuery,
  validateDiscoverQuery,
  validateClaimCreate,
  validateRequestsQuery,
} from "../validation/grn.mjs";
import {
  listMyListings,
  discoverListings,
  listRequests,
  createClaim,
  getClaim,
} from "../lib/grn.mjs";

// Good Roots Network (GRN) browse/claim/request proxy routes. Each handler
// validates inputs, calls the GRN client (api/lib/grn.mjs), and passes the
// upstream JSON straight back. The client throws typed errors
// (GrnNotConfigured -> 503, GrnUnauthorized -> 502, other upstream -> 502)
// which the http handler maps to status codes.
export function registerGrnRoutes(app) {
  // GET /grn/my-listings -> GET /my/listings (status/limit/offset).
  app.get("/grn/my-listings", async ({ event }) => {
    const query = validateMyListingsQuery(event.queryStringParameters ?? {});
    const correlationId = event?.requestContext?.requestId;
    const result = await listMyListings(query, { correlationId });
    return jsonResponse(200, result);
  });

  // GET /grn/discover?lat=&lng=&radius= -> GET /listings/discover. lat/lng are
  // mapped to a coarse geoKey + radiusMiles per the GRN discovery contract.
  app.get("/grn/discover", async ({ event }) => {
    const query = validateDiscoverQuery(event.queryStringParameters ?? {});
    const correlationId = event?.requestContext?.requestId;
    const result = await discoverListings(query, { correlationId });
    return jsonResponse(200, result);
  });

  // GET /grn/requests -> GET /requests.
  app.get("/grn/requests", async ({ event }) => {
    const query = validateRequestsQuery(event.queryStringParameters ?? {});
    const correlationId = event?.requestContext?.requestId;
    const result = await listRequests(query, { correlationId });
    return jsonResponse(200, result);
  });

  // POST /grn/claims -> POST /claims. Caller may supply an Idempotency-Key
  // header; we forward it so a retried claim is safe.
  app.post("/grn/claims", async ({ event }) => {
    const payload = validateClaimCreate(parseBody(event));
    const correlationId = event?.requestContext?.requestId;
    const idempotencyKey = headerValue(event, "idempotency-key");
    const result = await createClaim(payload, { idempotencyKey, correlationId });

    await publishEvent("GrnClaimCreated", {
      listingId: payload.listingId,
      claimId: result?.id ?? null,
      quantityClaimed: payload.quantityClaimed,
    });

    return jsonResponse(201, result);
  });

  // GET /grn/claims/{id} -> GET /claims/{claimId}.
  app.get("/grn/claims/:id", async ({ event, params }) => {
    const correlationId = event?.requestContext?.requestId;
    const result = await getClaim(params.id, { correlationId });
    return jsonResponse(200, result);
  });
}

// Case-insensitive header lookup over the proxy event's headers map.
function headerValue(event, name) {
  const headers = event?.headers ?? {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}
