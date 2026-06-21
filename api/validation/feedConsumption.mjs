import { BadRequestError } from "../services/errors.mjs";

// Validation + serialization for feed consumption (usage) records. Route
// handlers stay thin by delegating shape-checking here and formatting stored
// rows on the way out. Mirrors the feed-purchase validation conventions
// (see validation/feed.mjs): feedType is a free-form string normalized to
// lower case, with the chicken/layer/poultry aliases collapsed to a single
// "poultry" type so the analytics layer can sum poultry feed consumption by a
// stable type.
//
// Two payload shapes are accepted, distinguished by presence of `bags`:
//   - lbs shape:   { feedType, lbs, usedAt? }
//   - bag shape:   { feedType, bags, bagWeightLbs, usedAt? }  (lbs = bags * bagWeightLbs)

// Feed types that count as poultry for cost-per-dozen analytics. Kept in sync
// with validation/feed.mjs (the purchase side) so the two never diverge.
const POULTRY_TYPES = new Set(["chicken", "layer", "poultry"]);

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YYYY_MM_RE = /^\d{4}-\d{2}$/;

// Normalizes a feedType the same way feed purchases do: trim, lower-case, and
// collapse the chicken/layer/poultry aliases onto "poultry".
function normalizeFeedType(value) {
  if (typeof value !== "string") {
    throw new BadRequestError("feedType is required (1-64 chars)");
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 64) {
    throw new BadRequestError("feedType is required (1-64 chars)");
  }
  if (POULTRY_TYPES.has(trimmed)) return "poultry";
  return trimmed;
}

// Normalizes a usedAt/date value to an ISO timestamp. Empty -> now.
function normalizeUsedAt(value) {
  if (value === undefined || value === null || value === "") {
    return new Date().toISOString();
  }
  if (typeof value !== "string" || isNaN(Date.parse(value))) {
    throw new BadRequestError("usedAt must be an ISO date or date-time string");
  }
  if (ISO_DATE_RE.test(value)) {
    return new Date(`${value}T00:00:00.000Z`).toISOString();
  }
  return new Date(value).toISOString();
}

// Validates the POST /feed-consumption body. Returns a clean fields object the
// domain layer turns into a row. Dispatches on `bags`: the bag shape derives
// lbs = bags * bagWeightLbs; the lbs shape takes `lbs` directly. usedAt is
// normalized to an ISO timestamp so the sort key + month bucket stay
// consistent.
export function validateFeedConsumptionCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const { feedType, lbs, bags, bagWeightLbs, usedAt, date } = body;
  const normalizedType = normalizeFeedType(feedType);

  let resolvedLbs;
  if (bags !== undefined) {
    // Bag shape: derive lbs from bags * bagWeightLbs.
    if (typeof bags !== "number" || !Number.isInteger(bags) || bags < 1) {
      throw new BadRequestError("bags must be an integer >= 1");
    }
    if (typeof bagWeightLbs !== "number" || !Number.isFinite(bagWeightLbs) || bagWeightLbs <= 0) {
      throw new BadRequestError("bagWeightLbs must be a positive number");
    }
    resolvedLbs = bags * bagWeightLbs;
  } else {
    // Lbs shape.
    if (typeof lbs !== "number" || !Number.isFinite(lbs) || lbs <= 0) {
      throw new BadRequestError("lbs must be a positive number");
    }
    resolvedLbs = lbs;
  }

  return {
    feedType: normalizedType,
    lbs: resolvedLbs,
    usedAt: normalizeUsedAt(usedAt ?? date),
  };
}

// Parses the GET /feed-consumption query string. `from`/`to` accept an ISO
// date (YYYY-MM-DD) or a month bucket (YYYY-MM); `type` is optional. The
// bounds come back as ISO timestamps so the domain layer can build the
// `USE#<ts>` sort-key range and the month fan-out list. `to` is inclusive of
// the whole final day/month.
export function validateFeedConsumptionQuery(query = {}) {
  const { from, to, type } = query ?? {};

  const fromTs = from === undefined ? undefined : parseBound(from, "from", false);
  const toTs = to === undefined ? undefined : parseBound(to, "to", true);

  if (fromTs && toTs && fromTs > toTs) {
    throw new BadRequestError("from must be on or before to");
  }

  if (type !== undefined && (typeof type !== "string" || type.trim().length === 0)) {
    throw new BadRequestError("type must be a non-empty string");
  }

  return {
    fromTs,
    toTs,
    type: type === undefined ? undefined : normalizeFeedType(type),
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
// (pk/sk) never leak to clients.
export function formatFeedConsumption(row) {
  return {
    id: row.id,
    feedType: row.feedType,
    lbs: row.lbs,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}
