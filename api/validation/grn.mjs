import { BadRequestError } from "../services/errors.mjs";
import { HARVEST_UNITS } from "./harvest.mjs";

// Validation + payload mapping for the Good Roots Network (GRN) two-way
// integration. Input shapes here mirror the GRN OpenAPI contract
// (services/grn-api/openapi/schemas/*). Field names/enums are taken verbatim
// from that contract so the client sends exactly what GRN expects.

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GRN UpsertListingRequest enums.
const PICKUP_DISCLOSURE = new Set(["address_visible", "after_confirmed", "never"]);
const CONTACT_PREF = new Set(["in_app", "email", "either"]);

function requireUuid(value, label) {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new BadRequestError(`${label} must be a UUID`);
  }
  return value;
}

function optionalUuid(value, label) {
  if (value === undefined || value === null || value === "") return undefined;
  return requireUuid(value, label);
}

function toIsoDateTime(value, label) {
  if (typeof value !== "string") {
    throw new BadRequestError(`${label} must be a date-time string`);
  }
  if (ISO_DATE_RE.test(value) && !isNaN(Date.parse(value))) {
    return new Date(`${value}T00:00:00.000Z`).toISOString();
  }
  if (ISO_DATETIME_RE.test(value) && !isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new BadRequestError(`${label} must be a YYYY-MM-DD or ISO date-time string`);
}

// Builds a GRN UpsertListingRequest from a stored harvest log + the publish
// request body. The harvest gives quantity/unit and (optionally) defaults; the
// body must supply the GRN cropId (a catalog UUID the harvest doesn't carry)
// and the availability window. Returns the exact upstream payload.
export function buildListingPayload(harvest, body = {}) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  // cropId is REQUIRED by UpsertListingRequest and is a GRN catalog UUID, so it
  // must come from the publish body (the local harvest only has a crop name).
  const cropId = requireUuid(body.cropId, "cropId");
  const varietyId = optionalUuid(body.varietyId, "varietyId");

  // Quantity/unit default from the harvest but can be overridden in the body.
  const quantityTotal = body.quantityTotal ?? harvest.quantity;
  if (typeof quantityTotal !== "number" || !Number.isFinite(quantityTotal) || quantityTotal <= 0) {
    throw new BadRequestError("quantityTotal must be a positive number");
  }

  const unit = (body.unit ?? harvest.unit);
  if (typeof unit !== "string" || (!HARVEST_UNITS.has(unit) && unit.trim().length === 0)) {
    throw new BadRequestError("unit is required");
  }

  // Availability window: default the start to the harvest date and require an
  // end (GRN marks both required).
  const availableStart = toIsoDateTime(
    body.availableStart ?? harvest.harvestedAt,
    "availableStart",
  );
  if (body.availableEnd === undefined || body.availableEnd === null || body.availableEnd === "") {
    throw new BadRequestError("availableEnd is required");
  }
  const availableEnd = toIsoDateTime(body.availableEnd, "availableEnd");

  const title = typeof body.title === "string" && body.title.trim().length > 0
    ? body.title.trim()
    : `${harvest.cropName}${harvest.variety ? ` (${harvest.variety})` : ""}`;

  const payload = {
    title,
    cropId,
    quantityTotal,
    unit,
    availableStart,
    availableEnd,
    status: "active",
  };
  if (varietyId) payload.varietyId = varietyId;

  if (body.pickupLocationText !== undefined) payload.pickupLocationText = String(body.pickupLocationText);
  if (body.pickupAddress !== undefined) payload.pickupAddress = String(body.pickupAddress);
  if (body.pickupNotes !== undefined) payload.pickupNotes = String(body.pickupNotes);

  if (body.pickupDisclosurePolicy !== undefined) {
    if (!PICKUP_DISCLOSURE.has(body.pickupDisclosurePolicy)) {
      throw new BadRequestError(`pickupDisclosurePolicy must be one of ${[...PICKUP_DISCLOSURE].join(", ")}`);
    }
    payload.pickupDisclosurePolicy = body.pickupDisclosurePolicy;
  }
  if (body.contactPref !== undefined) {
    if (!CONTACT_PREF.has(body.contactPref)) {
      throw new BadRequestError(`contactPref must be one of ${[...CONTACT_PREF].join(", ")}`);
    }
    payload.contactPref = body.contactPref;
  }

  return payload;
}

// Validates the GET /grn/my-listings query (status/limit/offset pass-through).
export function validateMyListingsQuery(query = {}) {
  const out = {};
  const { status } = query ?? {};
  if (status !== undefined && status !== null && status !== "") {
    if (!["active", "claimed", "expired"].includes(status)) {
      throw new BadRequestError("status must be one of active, claimed, expired");
    }
    out.status = status;
  }
  out.limit = parsePageInt(query?.limit, "limit");
  out.offset = parsePageInt(query?.offset, "offset");
  return out;
}

// Validates the GET /grn/discover query. The GRN contract discovers by a
// `geoKey` (+ radiusMiles); we accept lat/lng/radius (the task's interface) and
// derive a coarse geoKey from them, passing radius through as radiusMiles.
export function validateDiscoverQuery(query = {}) {
  const { lat, lng, radius, geoKey } = query ?? {};
  const out = {};

  if (geoKey !== undefined && geoKey !== null && geoKey !== "") {
    out.geoKey = String(geoKey);
  } else if (lat !== undefined && lng !== undefined) {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      throw new BadRequestError("lat must be a number between -90 and 90");
    }
    if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      throw new BadRequestError("lng must be a number between -180 and 180");
    }
    out.geoKey = geoKeyFor(latNum, lngNum);
  } else {
    throw new BadRequestError("geoKey, or both lat and lng, are required");
  }

  if (radius !== undefined && radius !== null && radius !== "") {
    const r = Number(radius);
    if (!Number.isFinite(r) || r <= 0) {
      throw new BadRequestError("radius must be a positive number (miles)");
    }
    out.radiusMiles = r;
  }
  return out;
}

// Coarse geohash-style key: round lat/lng to ~0.1 degree cells. GRN's discovery
// keys off geoKey; this gives a stable bucket without shipping a geohash lib.
function geoKeyFor(lat, lng) {
  const round = (n) => (Math.round(n * 10) / 10).toFixed(1);
  return `${round(lat)},${round(lng)}`;
}

// Validates the POST /grn/claims body -> GRN CreateClaimRequest.
export function validateClaimCreate(body = {}) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }
  const listingId = requireUuid(body.listingId, "listingId");
  const requestId = optionalUuid(body.requestId, "requestId");

  const quantityClaimed = body.quantityClaimed;
  if (typeof quantityClaimed !== "number" || !Number.isFinite(quantityClaimed) || quantityClaimed <= 0) {
    throw new BadRequestError("quantityClaimed must be a positive number");
  }

  const payload = { listingId, quantityClaimed };
  if (requestId) payload.requestId = requestId;
  if (body.notes !== undefined && body.notes !== null && body.notes !== "") {
    if (typeof body.notes !== "string" || body.notes.length > 1000) {
      throw new BadRequestError("notes must be a string (<= 1000 chars)");
    }
    payload.notes = body.notes;
  }
  return payload;
}

// Validates the GET /grn/requests query (limit/offset pass-through).
export function validateRequestsQuery(query = {}) {
  return {
    limit: parsePageInt(query?.limit, "limit"),
    offset: parsePageInt(query?.offset, "offset"),
  };
}

function parsePageInt(raw, label) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestError(`${label} must be a non-negative integer`);
  }
  return parsed;
}
