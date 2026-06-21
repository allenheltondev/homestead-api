import { BadRequestError } from "../services/errors.mjs";

// Validation + serialization for health expense records. Route handlers stay
// thin by delegating shape-checking here and formatting stored rows on the
// way out. Mirrors the feed-consumption validation conventions (see
// validation/feedConsumption.mjs): an `incurredAt` timestamp drives the month
// bucket + sort key, `category` is a free-form lower-cased string, and the
// optional `animalRef` / `note` ride along.
//
// Payload shape: { category, cost, animalRef?, note?, incurredAt? | date? }

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YYYY_MM_RE = /^\d{4}-\d{2}$/;

const CATEGORY_MAX = 64;
const NOTE_MAX = 500;
const ANIMAL_REF_MAX = 128;

// Normalizes a category: trim + lower-case so the analytics layer groups by a
// stable key regardless of how the client cased it.
function normalizeCategory(value) {
  if (typeof value !== "string") {
    throw new BadRequestError(`category is required (1-${CATEGORY_MAX} chars)`);
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > CATEGORY_MAX) {
    throw new BadRequestError(`category is required (1-${CATEGORY_MAX} chars)`);
  }
  return trimmed;
}

// Normalizes an incurredAt/date value to an ISO timestamp. Empty -> now.
function normalizeIncurredAt(value) {
  if (value === undefined || value === null || value === "") {
    return new Date().toISOString();
  }
  if (typeof value !== "string" || isNaN(Date.parse(value))) {
    throw new BadRequestError("incurredAt must be an ISO date or date-time string");
  }
  if (ISO_DATE_RE.test(value)) {
    return new Date(`${value}T00:00:00.000Z`).toISOString();
  }
  return new Date(value).toISOString();
}

// Validates the POST /health-expenses body. Returns a clean fields object the
// domain layer turns into a row. incurredAt is normalized to an ISO timestamp
// so the sort key + month bucket stay consistent.
export function validateHealthExpenseCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const { category, cost, animalRef, note, incurredAt, date } = body;

  const normalizedCategory = normalizeCategory(category);

  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
    throw new BadRequestError("cost must be a non-negative number");
  }

  let normalizedAnimalRef;
  if (animalRef !== undefined && animalRef !== null && animalRef !== "") {
    if (typeof animalRef !== "string" || animalRef.length > ANIMAL_REF_MAX) {
      throw new BadRequestError(`animalRef must be a string up to ${ANIMAL_REF_MAX} chars`);
    }
    normalizedAnimalRef = animalRef.trim();
  }

  let normalizedNote;
  if (note !== undefined && note !== null && note !== "") {
    if (typeof note !== "string" || note.length > NOTE_MAX) {
      throw new BadRequestError(`note must be a string up to ${NOTE_MAX} chars`);
    }
    normalizedNote = note.trim();
  }

  return {
    category: normalizedCategory,
    cost,
    animalRef: normalizedAnimalRef,
    note: normalizedNote,
    incurredAt: normalizeIncurredAt(incurredAt ?? date),
  };
}

// Parses the GET /health-expenses query string. `from`/`to` accept an ISO
// date (YYYY-MM-DD) or a month bucket (YYYY-MM); `category` is optional. The
// bounds come back as ISO timestamps so the domain layer can build the
// `EXP#<ts>` sort-key range and the month fan-out list. `to` is inclusive of
// the whole final day/month.
export function validateHealthExpenseQuery(query = {}) {
  const { from, to, category } = query ?? {};

  const fromTs = from === undefined ? undefined : parseBound(from, "from", false);
  const toTs = to === undefined ? undefined : parseBound(to, "to", true);

  if (fromTs && toTs && fromTs > toTs) {
    throw new BadRequestError("from must be on or before to");
  }

  if (category !== undefined && (typeof category !== "string" || category.trim().length === 0)) {
    throw new BadRequestError("category must be a non-empty string");
  }

  return {
    fromTs,
    toTs,
    category: category === undefined ? undefined : normalizeCategory(category),
  };
}

// Converts a `from`/`to` bound into an ISO timestamp. `inclusiveEnd` pushes a
// date/month bound to the end of that day/month so a range like to=2026-06
// covers all of June. Mirrors the feed/eggs query bound parsing.
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
// (pk/sk) never leak to clients. Optional fields appear only when present.
export function formatHealthExpense(row) {
  const out = {
    id: row.id,
    category: row.category,
    cost: row.cost,
    incurredAt: row.incurredAt,
    createdAt: row.createdAt,
  };
  if (row.animalRef !== undefined) out.animalRef = row.animalRef;
  if (row.note !== undefined) out.note = row.note;
  return out;
}
