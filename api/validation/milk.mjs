import { BadRequestError } from "../services/errors.mjs";

// Validation + serialization for milk logs. Route handlers stay thin by
// delegating shape-checking here and formatting stored rows on the way out.
// The create body takes a `date` (YYYY-MM-DD or ISO date-time, defaults to
// today) normalized to an ISO timestamp so the sort key orders chronologically
// and the month bucket (pk) derives from the same value.

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YYYY_MM_RE = /^\d{4}-\d{2}$/;

// Volume units accepted. `gallon` is the default + canonical reporting unit;
// the others are normalized to gallons in the stats layer.
const UNITS = new Set(["gallon", "quart", "liter", "ml"]);

// Validates the POST /milk-logs body. Returns a clean fields object the domain
// layer turns into a row. `loggedAt` is an ISO timestamp so the sort key +
// month bucket stay consistent.
export function validateMilkLogCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const { animalId, volume, unit, date, loggedAt } = body;

  if (typeof volume !== "number" || !Number.isFinite(volume) || volume <= 0) {
    throw new BadRequestError("volume must be a positive number");
  }

  let normalizedUnit = "gallon";
  if (unit !== undefined && unit !== null && unit !== "") {
    if (typeof unit !== "string" || !UNITS.has(unit.trim().toLowerCase())) {
      throw new BadRequestError(`unit must be one of ${[...UNITS].join(", ")}`);
    }
    normalizedUnit = unit.trim().toLowerCase();
  }

  let normalizedAnimalId;
  if (animalId !== undefined && animalId !== null && animalId !== "") {
    if (typeof animalId !== "string" || animalId.trim().length === 0 || animalId.length > 128) {
      throw new BadRequestError("animalId must be a non-empty string (1-128 chars)");
    }
    normalizedAnimalId = animalId.trim();
  }

  return {
    animalId: normalizedAnimalId,
    volume,
    unit: normalizedUnit,
    loggedAt: normalizeLoggedAt(date ?? loggedAt),
  };
}

// Normalizes a date/loggedAt value to an ISO timestamp. Empty -> today at UTC
// midnight (mirrors the egg-collection default).
function normalizeLoggedAt(value) {
  if (value === undefined || value === null || value === "") {
    const today = new Date().toISOString().slice(0, 10);
    return new Date(`${today}T00:00:00.000Z`).toISOString();
  }
  if (typeof value === "string" && ISO_DATE_RE.test(value) && !isNaN(Date.parse(value))) {
    return new Date(`${value}T00:00:00.000Z`).toISOString();
  }
  if (typeof value === "string" && ISO_DATETIME_RE.test(value) && !isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new BadRequestError("date must be a YYYY-MM-DD or ISO date-time string");
}

// Parses the GET /milk-logs query string. `from`/`to` accept an ISO date
// (YYYY-MM-DD) or a month bucket (YYYY-MM); bounds come back as ISO timestamps
// so the domain layer can build the `LOG#<ts>` sort-key range and the month
// fan-out list. `to` is inclusive of the whole final day/month.
export function validateMilkLogQuery(query = {}) {
  const { from, to } = query ?? {};

  const fromTs = from === undefined ? undefined : parseBound(from, "from", false);
  const toTs = to === undefined ? undefined : parseBound(to, "to", true);

  if (fromTs && toTs && fromTs > toTs) {
    throw new BadRequestError("from must be on or before to");
  }

  return { fromTs, toTs };
}

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

// Maps a stored row to the API response shape. Internal key attributes never
// leak to clients.
export function formatMilkLog(row) {
  return {
    id: row.id,
    animalId: row.animalId ?? null,
    volume: row.volume,
    unit: row.unit,
    loggedAt: row.loggedAt,
    createdAt: row.createdAt,
  };
}
