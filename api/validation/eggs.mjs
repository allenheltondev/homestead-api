import { BadRequestError } from "../services/errors.mjs";

// Validation + serialization for egg collections. Route handlers stay thin
// by delegating shape-checking here and formatting stored rows on the way
// out. The create body takes a `date` (YYYY-MM-DD, defaults to today) which
// is normalized to an ISO timestamp so the sort key orders chronologically;
// the month bucket (pk) derives from the same value.

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YYYY_MM_RE = /^\d{4}-\d{2}$/;

// Bird types eggs can be attributed to. Defaults to chicken so legacy
// payloads (no birdType) behave exactly as before.
export const BIRD_TYPES = new Set(["chicken", "duck", "goose", "turkey"]);
export const DEFAULT_BIRD_TYPE = "chicken";

// Normalizes an optional birdType. Returns the default (chicken) when absent
// so existing behavior is identical when birdType is omitted.
export function normalizeBirdType(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_BIRD_TYPE;
  if (typeof value !== "string" || !BIRD_TYPES.has(value.trim().toLowerCase())) {
    throw new BadRequestError(`birdType must be one of ${[...BIRD_TYPES].join(", ")}`);
  }
  return value.trim().toLowerCase();
}

// Validates the POST /egg-collections body. Returns a clean fields object
// the domain layer turns into a row. `collectedAt` is an ISO timestamp so
// the sort key + month bucket stay consistent.
export function validateEggCollectionCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const { count, date, coop, birdType } = body;

  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
    throw new BadRequestError("count must be an integer >= 1");
  }

  const normalizedBirdType = normalizeBirdType(birdType);

  let collectedAt;
  if (date === undefined || date === null || date === "") {
    // Default to today's date at UTC midnight.
    const today = new Date().toISOString().slice(0, 10);
    collectedAt = new Date(`${today}T00:00:00.000Z`).toISOString();
  } else if (typeof date === "string" && ISO_DATE_RE.test(date) && !isNaN(Date.parse(date))) {
    collectedAt = new Date(`${date}T00:00:00.000Z`).toISOString();
  } else if (typeof date === "string" && ISO_DATETIME_RE.test(date) && !isNaN(Date.parse(date))) {
    collectedAt = new Date(date).toISOString();
  } else {
    throw new BadRequestError("date must be a YYYY-MM-DD or ISO date-time string");
  }

  let normalizedCoop;
  if (coop !== undefined && coop !== null && coop !== "") {
    if (typeof coop !== "string" || coop.trim().length === 0 || coop.length > 128) {
      throw new BadRequestError("coop must be a non-empty string (1-128 chars)");
    }
    normalizedCoop = coop.trim();
  }

  return {
    count,
    collectedAt,
    coop: normalizedCoop,
    birdType: normalizedBirdType,
  };
}

// Parses the GET /egg-collections query string. `from`/`to` accept an ISO
// date (YYYY-MM-DD) or a month bucket (YYYY-MM). The bounds come back as ISO
// timestamps so the domain layer can build the `COLLECT#<ts>` sort-key range
// and the month fan-out list; `to` is inclusive of the whole final day/month.
export function validateEggCollectionQuery(query = {}) {
  const { from, to } = query ?? {};

  const fromTs = from === undefined ? undefined : parseBound(from, "from", false);
  const toTs = to === undefined ? undefined : parseBound(to, "to", true);

  if (fromTs && toTs && fromTs > toTs) {
    throw new BadRequestError("from must be on or before to");
  }

  return { fromTs, toTs };
}

// Parses an optional ?birdType filter for the egg stats endpoints. Returns
// undefined when absent (so the default, unfiltered behavior is preserved) and
// a normalized value otherwise.
export function parseBirdTypeFilter(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !BIRD_TYPES.has(value.trim().toLowerCase())) {
    throw new BadRequestError(`birdType must be one of ${[...BIRD_TYPES].join(", ")}`);
  }
  return value.trim().toLowerCase();
}

// Converts a `from`/`to` bound into an ISO timestamp. `inclusiveEnd` pushes a
// date/month bound to the end of that day/month so a range like to=2026-06
// covers all of June.
function parseBound(value, label, inclusiveEnd) {
  if (typeof value !== "string") {
    throw new BadRequestError(`${label} must be an ISO date or YYYY-MM string`);
  }

  if (YYYY_MM_RE.test(value)) {
    const [year, month] = value.split("-").map(Number);
    if (month < 1 || month > 12) {
      throw new BadRequestError(`${label} has an invalid month`);
    }
    if (inclusiveEnd) {
      return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString();
    }
    return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)).toISOString();
  }

  if (ISO_DATE_RE.test(value)) {
    if (isNaN(Date.parse(value))) {
      throw new BadRequestError(`${label} is not a valid date`);
    }
    if (inclusiveEnd) {
      const [year, month, day] = value.split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999)).toISOString();
    }
    return new Date(`${value}T00:00:00.000Z`).toISOString();
  }

  if (ISO_DATETIME_RE.test(value) && !isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }

  throw new BadRequestError(`${label} must be an ISO date, date-time, or YYYY-MM string`);
}

// Maps a stored row to the API response shape. Internal key attributes
// (pk/sk) never leak to clients.
export function formatEggCollection(row) {
  return {
    id: row.id,
    count: row.count,
    collectedAt: row.collectedAt,
    coop: row.coop ?? null,
    // Stored rows default to chicken; legacy rows (no birdType) report chicken
    // so the field is always present and the breakdown stays consistent.
    birdType: row.birdType ?? DEFAULT_BIRD_TYPE,
    createdAt: row.createdAt,
  };
}
