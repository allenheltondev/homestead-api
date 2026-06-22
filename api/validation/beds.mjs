import { BadRequestError } from "../services/errors.mjs";

// Validation + serialization for garden beds. Beds are simple metadata
// records: a required name and an optional size in square feet.

function normalizeName(value, { required }) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new BadRequestError("name is required");
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
    throw new BadRequestError("name must be a non-empty string (1-128 chars)");
  }
  return value.trim();
}

function normalizeSize(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new BadRequestError("sizeSqFt must be a positive number");
  }
  return value;
}

// Validates the POST /beds body.
export function validateBedCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }
  return {
    name: normalizeName(body.name, { required: true }),
    sizeSqFt: normalizeSize(body.sizeSqFt),
  };
}

// Validates the PATCH /beds/{id} body. At least one updatable field must be
// present; only the supplied fields are returned.
export function validateBedUpdate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const fields = {};
  if ("name" in body) fields.name = normalizeName(body.name, { required: true });
  if ("sizeSqFt" in body) {
    const size = normalizeSize(body.sizeSqFt);
    if (size === undefined) {
      throw new BadRequestError("sizeSqFt must be a positive number");
    }
    fields.sizeSqFt = size;
  }

  if (Object.keys(fields).length === 0) {
    throw new BadRequestError("no updatable fields supplied (name, sizeSqFt)");
  }
  return fields;
}

// Maps a stored row to the API response shape. Internal key attributes never
// leak to clients.
export function formatBed(row) {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name,
    sizeSqFt: row.sizeSqFt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? null,
  };
}
