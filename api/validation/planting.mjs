import { BadRequestError } from "../services/errors.mjs";
import { PLANTING_STATUSES } from "../domain/planting.mjs";

// Validation + serialization for plantings. `plantedAt` /
// `expectedHarvestAt` are normalized to ISO timestamps so the GSI sort key
// orders chronologically.

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_STATUS = "growing";

// Normalizes a YYYY-MM-DD or ISO date-time to an ISO timestamp. Empty values
// fall back to `fallback` when given (else throw / return undefined).
function normalizeDate(value, label, { required = false, optional = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      const today = new Date().toISOString().slice(0, 10);
      return new Date(`${today}T00:00:00.000Z`).toISOString();
    }
    if (optional) return undefined;
    return undefined;
  }
  if (typeof value === "string" && ISO_DATE_RE.test(value) && !isNaN(Date.parse(value))) {
    return new Date(`${value}T00:00:00.000Z`).toISOString();
  }
  if (typeof value === "string" && ISO_DATETIME_RE.test(value) && !isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new BadRequestError(`${label} must be a YYYY-MM-DD or ISO date-time string`);
}

function normalizeText(value, label, { required = false, max = 128 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new BadRequestError(`${label} is required`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new BadRequestError(`${label} must be a non-empty string (1-${max} chars)`);
  }
  return value.trim();
}

function normalizeStatus(value, { fallback }) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !PLANTING_STATUSES.has(value.trim().toLowerCase())) {
    throw new BadRequestError(`status must be one of ${[...PLANTING_STATUSES].join(", ")}`);
  }
  return value.trim().toLowerCase();
}

// Validates the POST /plantings body.
export function validatePlantingCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  return {
    bedId: normalizeText(body.bedId, "bedId"),
    cropName: normalizeText(body.cropName, "cropName", { required: true }),
    variety: normalizeText(body.variety, "variety"),
    plantedAt: normalizeDate(body.plantedAt ?? body.plantedDate, "plantedAt", { required: true }),
    expectedHarvestAt: normalizeDate(
      body.expectedHarvestAt,
      "expectedHarvestAt",
      { optional: true },
    ),
    status: normalizeStatus(body.status, { fallback: DEFAULT_STATUS }),
  };
}

// Validates the PATCH /plantings/{id} body. At least one updatable field must
// be present; only the supplied fields are returned.
export function validatePlantingUpdate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const fields = {};
  if ("bedId" in body) fields.bedId = normalizeText(body.bedId, "bedId");
  if ("cropName" in body) fields.cropName = normalizeText(body.cropName, "cropName", { required: true });
  if ("variety" in body) fields.variety = normalizeText(body.variety, "variety");
  if ("plantedAt" in body) {
    fields.plantedAt = normalizeDate(body.plantedAt, "plantedAt", { required: true });
  }
  if ("expectedHarvestAt" in body) {
    fields.expectedHarvestAt = normalizeDate(body.expectedHarvestAt, "expectedHarvestAt", { optional: true });
  }
  if ("status" in body) fields.status = normalizeStatus(body.status, { fallback: undefined });

  // Drop keys that normalized to undefined so we never write empty values.
  for (const key of Object.keys(fields)) {
    if (fields[key] === undefined) delete fields[key];
  }

  if (Object.keys(fields).length === 0) {
    throw new BadRequestError("no updatable fields supplied");
  }
  return fields;
}

// Parses the GET /plantings query string. Only an optional status filter.
export function validatePlantingQuery(query = {}) {
  const { status } = query ?? {};
  if (status === undefined || status === null || status === "") return {};
  if (typeof status !== "string" || !PLANTING_STATUSES.has(status.trim().toLowerCase())) {
    throw new BadRequestError(`status must be one of ${[...PLANTING_STATUSES].join(", ")}`);
  }
  return { status: status.trim().toLowerCase() };
}

// Maps a stored row to the API response shape.
export function formatPlanting(row) {
  if (!row) return row;
  return {
    id: row.id,
    bedId: row.bedId ?? null,
    cropName: row.cropName,
    variety: row.variety ?? null,
    plantedAt: row.plantedAt,
    expectedHarvestAt: row.expectedHarvestAt ?? null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? null,
  };
}
