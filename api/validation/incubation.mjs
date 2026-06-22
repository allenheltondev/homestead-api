import { BadRequestError } from "../services/errors.mjs";

// Validation + serialization for incubation batches. The create body takes a
// species, an egg count, and a `setAt` date (YYYY-MM-DD or ISO date-time,
// defaults to now); expectedHatchAt is computed in the domain layer from the
// species incubation days.

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Species accepted. Free-form would complicate hatch-day computation, so we
// constrain to the species with known incubation periods (default falls back
// to 21 days in the domain layer for anything else, but we validate the set
// here so typos surface as 400s).
const SPECIES = new Set(["chicken", "duck", "goose", "turkey"]);

// Statuses a batch can be patched into when recording a hatch.
const HATCH_STATUSES = new Set(["hatched", "partial", "failed"]);

export function validateIncubationCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const { species, count, setAt, date } = body;

  if (typeof species !== "string" || !SPECIES.has(species.trim().toLowerCase())) {
    throw new BadRequestError(`species must be one of ${[...SPECIES].join(", ")}`);
  }

  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
    throw new BadRequestError("count must be an integer >= 1");
  }

  return {
    species: species.trim().toLowerCase(),
    count,
    setAt: normalizeTimestamp(setAt ?? date),
  };
}

// PATCH body: record a hatch. hatchedCount is required (>= 0); status is
// optional (defaults to "hatched" in the domain layer).
export function validateIncubationHatch(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const { hatchedCount, status } = body;

  if (typeof hatchedCount !== "number" || !Number.isInteger(hatchedCount) || hatchedCount < 0) {
    throw new BadRequestError("hatchedCount must be an integer >= 0");
  }

  let normalizedStatus;
  if (status !== undefined && status !== null && status !== "") {
    if (typeof status !== "string" || !HATCH_STATUSES.has(status.trim().toLowerCase())) {
      throw new BadRequestError(`status must be one of ${[...HATCH_STATUSES].join(", ")}`);
    }
    normalizedStatus = status.trim().toLowerCase();
  }

  return { hatchedCount, status: normalizedStatus };
}

// Normalizes a date/setAt value to an ISO timestamp. Empty -> now.
function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === "") {
    return new Date().toISOString();
  }
  if (typeof value === "string" && ISO_DATE_RE.test(value) && !isNaN(Date.parse(value))) {
    return new Date(`${value}T00:00:00.000Z`).toISOString();
  }
  if (typeof value === "string" && ISO_DATETIME_RE.test(value) && !isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new BadRequestError("setAt must be a YYYY-MM-DD or ISO date-time string");
}

export function formatIncubationBatch(row) {
  return {
    id: row.id,
    species: row.species,
    count: row.count,
    setAt: row.setAt,
    expectedHatchAt: row.expectedHatchAt,
    hatchedCount: row.hatchedCount ?? null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
