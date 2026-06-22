import { BadRequestError } from "../services/errors.mjs";

// Validation + serialization for breeding records. The create body takes a
// species, a dam id, an optional sire id, and a `bredAt` date (defaults to
// now); expectedDueAt is computed in the domain layer from gestation days.

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Species with known gestation periods. Anything else defaults to 150 days in
// the domain layer, but we constrain the input here so typos surface as 400s.
const SPECIES = new Set(["goat", "sheep", "pig"]);

export function validateBreedingCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const { species, damId, sireId, bredAt, date } = body;

  if (typeof species !== "string" || !SPECIES.has(species.trim().toLowerCase())) {
    throw new BadRequestError(`species must be one of ${[...SPECIES].join(", ")}`);
  }

  if (typeof damId !== "string" || damId.trim().length === 0 || damId.length > 128) {
    throw new BadRequestError("damId is required (1-128 chars)");
  }

  let normalizedSireId;
  if (sireId !== undefined && sireId !== null && sireId !== "") {
    if (typeof sireId !== "string" || sireId.trim().length === 0 || sireId.length > 128) {
      throw new BadRequestError("sireId must be a non-empty string (1-128 chars)");
    }
    normalizedSireId = sireId.trim();
  }

  return {
    species: species.trim().toLowerCase(),
    damId: damId.trim(),
    sireId: normalizedSireId,
    bredAt: normalizeTimestamp(bredAt ?? date),
  };
}

// Parses ?withinDays for the upcoming-breeding stats endpoint. Defaults to 30,
// integer 1..3650.
export function parseWithinDays(value, fallback = 30) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
    throw new BadRequestError("withinDays must be an integer between 1 and 3650");
  }
  return parsed;
}

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
  throw new BadRequestError("bredAt must be a YYYY-MM-DD or ISO date-time string");
}

export function formatBreeding(row) {
  return {
    id: row.id,
    species: row.species,
    damId: row.damId,
    sireId: row.sireId ?? null,
    bredAt: row.bredAt,
    expectedDueAt: row.expectedDueAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
