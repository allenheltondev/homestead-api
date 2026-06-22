import { BadRequestError } from "../services/errors.mjs";

// Validation + payload mapping for the Good Roots Network (GRN) integration.
// Input shapes here mirror the GRN OpenAPI contract
// (services/grn-api/openapi/schemas/*). Field names/enums are taken verbatim
// from that contract so the client sends exactly what GRN expects.

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GRN UpsertListingRequest enums.
const PICKUP_DISCLOSURE = new Set(["address_visible", "after_confirmed", "never"]);
const CONTACT_PREF = new Set(["in_app", "email", "either"]);
const LISTING_STATUS = new Set(["active", "claimed", "expired"]);

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

// --- Crop harvests (GRN /crops/{id}/harvests) ----------------------------
// Validates a RecordHarvestRequest body (schemas/crop-library.yaml):
//   amount    REQUIRED, number > 0.
//   unit      optional string.
//   harvestedOn  optional YYYY-MM-DD date (defaults to today upstream).
//   notes     optional string (<= 1000 chars).
// Returns the clean upstream payload (drops empty optionals).
export function validateRecordHarvest(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const { amount, unit, harvestedOn, notes } = body;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new BadRequestError("amount must be a positive number");
  }

  const payload = { amount };

  if (unit !== undefined && unit !== null && unit !== "") {
    if (typeof unit !== "string" || unit.trim().length === 0 || unit.length > 32) {
      throw new BadRequestError("unit must be a non-empty string (1-32 chars)");
    }
    payload.unit = unit.trim();
  }

  if (harvestedOn !== undefined && harvestedOn !== null && harvestedOn !== "") {
    if (typeof harvestedOn !== "string" || !ISO_DATE_RE.test(harvestedOn) || isNaN(Date.parse(harvestedOn))) {
      throw new BadRequestError("harvestedOn must be a YYYY-MM-DD date");
    }
    payload.harvestedOn = harvestedOn;
  }

  if (notes !== undefined && notes !== null && notes !== "") {
    if (typeof notes !== "string" || notes.length > 1000) {
      throw new BadRequestError("notes must be a string (<= 1000 chars)");
    }
    payload.notes = notes;
  }

  return payload;
}

// --- Listing upsert (GRN /listings, PUT /listings/{id}) -------------------
// Validates an UpsertListingRequest body (schemas/listings.yaml). Required:
//   cropId (uuid), quantityTotal (>0), unit, availableEnd. Optional: title,
//   varietyId, availableStart, status, pickup*, contactPref. The body is
//   normalized to exactly what GRN expects (dates -> ISO).
export function validateListingUpsert(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const cropId = requireUuid(body.cropId, "cropId");
  const varietyId = optionalUuid(body.varietyId, "varietyId");

  const quantityTotal = body.quantityTotal;
  if (typeof quantityTotal !== "number" || !Number.isFinite(quantityTotal) || quantityTotal <= 0) {
    throw new BadRequestError("quantityTotal must be a positive number");
  }

  const unit = body.unit;
  if (typeof unit !== "string" || unit.trim().length === 0) {
    throw new BadRequestError("unit is required");
  }

  if (body.availableEnd === undefined || body.availableEnd === null || body.availableEnd === "") {
    throw new BadRequestError("availableEnd is required");
  }
  const availableEnd = toIsoDateTime(body.availableEnd, "availableEnd");
  const availableStart = body.availableStart === undefined || body.availableStart === null || body.availableStart === ""
    ? undefined
    : toIsoDateTime(body.availableStart, "availableStart");

  return assembleListingPayload({
    title: body.title,
    cropId,
    varietyId,
    quantityTotal,
    unit: unit.trim(),
    availableStart,
    availableEnd,
    status: body.status,
    pickupLocationText: body.pickupLocationText,
    pickupAddress: body.pickupAddress,
    pickupNotes: body.pickupNotes,
    pickupDisclosurePolicy: body.pickupDisclosurePolicy,
    contactPref: body.contactPref,
  });
}

// --- Crop-level surplus publishing ---------------------------------------
// Builds a GRN UpsertListingRequest from a fetched grower crop + the caller's
// publish-surplus body. The catalog cropId comes from the crop's `canonical_id`
// (the route 422s when it is missing) and varietyId from the crop's `variety_id`
// (a body override wins). The caller supplies amount/availableEnd/pickup fields.
export function buildSurplusListingPayload(growerCrop = {}, body = {}, { cropId } = {}) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const resolvedCropId = requireUuid(cropId, "cropId");
  // varietyId: body override wins, else the grower crop's variety. Both optional.
  const varietyId = optionalUuid(body.varietyId ?? growerCrop?.variety_id, "varietyId");

  const quantityTotal = body.amount ?? body.quantityTotal;
  if (typeof quantityTotal !== "number" || !Number.isFinite(quantityTotal) || quantityTotal <= 0) {
    throw new BadRequestError("amount must be a positive number");
  }

  // Unit: body override, else the crop's default_unit, else "lb".
  const rawUnit = body.unit ?? growerCrop?.default_unit ?? "lb";
  if (typeof rawUnit !== "string" || rawUnit.trim().length === 0) {
    throw new BadRequestError("unit must be a non-empty string");
  }
  const unit = rawUnit.trim();

  if (body.availableEnd === undefined || body.availableEnd === null || body.availableEnd === "") {
    throw new BadRequestError("availableEnd is required");
  }
  const availableEnd = toIsoDateTime(body.availableEnd, "availableEnd");
  const availableStart = body.availableStart === undefined || body.availableStart === null || body.availableStart === ""
    ? new Date().toISOString()
    : toIsoDateTime(body.availableStart, "availableStart");

  const cropName = typeof growerCrop?.nickname === "string" && growerCrop.nickname.trim().length > 0
    ? growerCrop.nickname.trim()
    : (typeof growerCrop?.crop_name === "string" ? growerCrop.crop_name : "Surplus");

  return assembleListingPayload({
    title: body.title ?? cropName,
    cropId: resolvedCropId,
    varietyId,
    quantityTotal,
    unit,
    availableStart,
    availableEnd,
    status: "active",
    pickupLocationText: body.pickupLocationText,
    pickupAddress: body.pickupAddress,
    pickupNotes: body.pickupNotes,
    pickupDisclosurePolicy: body.pickupDisclosurePolicy,
    contactPref: body.contactPref,
  });
}

// Shared assembler: validates the pickup/contact/status enums and drops empty
// optionals so the outbound UpsertListingRequest is exactly what GRN expects.
function assembleListingPayload(fields) {
  const title = typeof fields.title === "string" && fields.title.trim().length > 0
    ? fields.title.trim()
    : undefined;

  const payload = {
    cropId: fields.cropId,
    quantityTotal: fields.quantityTotal,
    unit: fields.unit,
    availableEnd: fields.availableEnd,
  };
  if (title) payload.title = title;
  if (fields.varietyId) payload.varietyId = fields.varietyId;
  if (fields.availableStart) payload.availableStart = fields.availableStart;

  if (fields.status !== undefined && fields.status !== null && fields.status !== "") {
    if (!LISTING_STATUS.has(fields.status)) {
      throw new BadRequestError(`status must be one of ${[...LISTING_STATUS].join(", ")}`);
    }
    payload.status = fields.status;
  } else {
    payload.status = "active";
  }

  if (fields.pickupLocationText !== undefined) payload.pickupLocationText = String(fields.pickupLocationText);
  if (fields.pickupAddress !== undefined) payload.pickupAddress = String(fields.pickupAddress);
  if (fields.pickupNotes !== undefined) payload.pickupNotes = String(fields.pickupNotes);

  if (fields.pickupDisclosurePolicy !== undefined && fields.pickupDisclosurePolicy !== null) {
    if (!PICKUP_DISCLOSURE.has(fields.pickupDisclosurePolicy)) {
      throw new BadRequestError(`pickupDisclosurePolicy must be one of ${[...PICKUP_DISCLOSURE].join(", ")}`);
    }
    payload.pickupDisclosurePolicy = fields.pickupDisclosurePolicy;
  }
  if (fields.contactPref !== undefined && fields.contactPref !== null) {
    if (!CONTACT_PREF.has(fields.contactPref)) {
      throw new BadRequestError(`contactPref must be one of ${[...CONTACT_PREF].join(", ")}`);
    }
    payload.contactPref = fields.contactPref;
  }

  return payload;
}

// Validates the GET /grn/my-listings query (status/limit/offset pass-through).
export function validateMyListingsQuery(query = {}) {
  const out = {};
  const { status } = query ?? {};
  if (status !== undefined && status !== null && status !== "") {
    if (!LISTING_STATUS.has(status)) {
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
