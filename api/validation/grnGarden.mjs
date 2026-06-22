import { BadRequestError } from "../services/errors.mjs";

// Light validation for the GRN crop-library + garden-bed pass-through routes.
// GRN is the single source of truth: we validate just enough shape/required
// fields (per the GRN OpenAPI schemas) to fail fast on obviously bad input,
// then forward the body faithfully so GRN remains authoritative. The upstream
// performs the full validation.

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// GrowerCrop enums (schemas/crop-library.yaml).
const CROP_STATUS = new Set(["interested", "planning", "growing", "paused"]);
const CROP_VISIBILITY = new Set(["private", "local", "public"]);

// GardenBed enums (schemas/garden.yaml).
const BED_TYPE = new Set(["in_ground", "raised", "mound"]);
const BED_SHAPE = new Set(["rect", "circle", "polygon"]);

function ensureObject(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }
  return body;
}

function optionalUuid(value, label) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new BadRequestError(`${label} must be a UUID`);
  }
  return value;
}

// Validates an UpsertGrowerCropRequest body. Required: status, visibility,
// surplus_enabled, plus either canonical_id or crop_name (anyOf in the
// contract). Everything else is forwarded as-is.
export function validateGrowerCropUpsert(body) {
  ensureObject(body);

  const status = body.status;
  if (typeof status !== "string" || !CROP_STATUS.has(status)) {
    throw new BadRequestError(`status must be one of ${[...CROP_STATUS].join(", ")}`);
  }
  const visibility = body.visibility;
  if (typeof visibility !== "string" || !CROP_VISIBILITY.has(visibility)) {
    throw new BadRequestError(`visibility must be one of ${[...CROP_VISIBILITY].join(", ")}`);
  }
  if (typeof body.surplus_enabled !== "boolean") {
    throw new BadRequestError("surplus_enabled must be a boolean");
  }

  optionalUuid(body.canonical_id, "canonical_id");
  optionalUuid(body.variety_id, "variety_id");

  const hasCanonical = typeof body.canonical_id === "string" && body.canonical_id.length > 0;
  const hasCropName = typeof body.crop_name === "string" && body.crop_name.trim().length > 0;
  if (!hasCanonical && !hasCropName) {
    throw new BadRequestError("either canonical_id or crop_name is required");
  }

  // Forward the body verbatim — GRN owns the full schema.
  return { ...body };
}

// Validates an UpsertGardenBedRequest body. Required: name. bed_type / shape /
// rotation enums are checked when present; the rest is forwarded as-is.
export function validateGardenBedUpsert(body) {
  ensureObject(body);

  if (typeof body.name !== "string" || body.name.trim().length === 0 || body.name.length > 80) {
    throw new BadRequestError("name is required (1-80 chars)");
  }

  const bedType = body.bed_type ?? body.bedType;
  if (bedType !== undefined && bedType !== null && !BED_TYPE.has(bedType)) {
    throw new BadRequestError(`bed_type must be one of ${[...BED_TYPE].join(", ")}`);
  }
  if (body.shape !== undefined && body.shape !== null && !BED_SHAPE.has(body.shape)) {
    throw new BadRequestError(`shape must be one of ${[...BED_SHAPE].join(", ")}`);
  }

  const rotation = body.rotation_deg ?? body.rotationDeg;
  if (rotation !== undefined && rotation !== null) {
    if (typeof rotation !== "number" || !Number.isInteger(rotation) || rotation < -360 || rotation > 360) {
      throw new BadRequestError("rotation_deg must be an integer between -360 and 360");
    }
  }

  // Forward the body verbatim (snake_case + camelCase aliases accepted by GRN).
  return { ...body };
}

// Parses pass-through pagination/query params (limit/offset) for the GET list
// routes. Non-negative integers only; empty values are dropped.
export function validateListQuery(query = {}) {
  const out = {};
  out.limit = parsePageInt(query?.limit, "limit");
  out.offset = parsePageInt(query?.offset, "offset");
  // Drop undefined so the client never appends empty query params.
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

function parsePageInt(raw, label) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestError(`${label} must be a non-negative integer`);
  }
  return parsed;
}
