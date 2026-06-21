import { BadRequestError } from "../services/errors.mjs";

// Validation + serialization for feed purchases. Route handlers stay thin
// by delegating shape-checking here and formatting stored rows on the way
// out. Types are free-form strings (e.g. "hay", "grain") but normalized to
// lower case so the GSI1 `FEED#<type>` partition is stable regardless of
// how the client cased the input.
//
// Two payload shapes are accepted, distinguished by presence of `bags`:
//   - bag shape:    { bags, bagWeightLbs, feedType, cost?, date? }
//   - legacy shape: { quantity, unit, type, cost, vendor, purchasedAt? }
// The bag shape additionally derives totalLbs = bags * bagWeightLbs. Both
// store a normalized `type`/`feedType`, `cost`, and `purchasedAt`.

const UNITS = new Set(["lb", "kg", "ton", "bag", "bale", "flake"]);

// Feed types that count as poultry for cost-per-dozen analytics.
const POULTRY_TYPES = new Set(["chicken", "layer", "poultry"]);

// ISO date-time, ISO date (YYYY-MM-DD), or month bucket (YYYY-MM). Used by
// the create body (purchasedAt) and the list query bounds (from / to).
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YYYY_MM_RE = /^\d{4}-\d{2}$/;

function normalizeType(value) {
  if (typeof value !== "string") {
    throw new BadRequestError("type is required (1-64 chars)");
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 64) {
    throw new BadRequestError("type is required (1-64 chars)");
  }
  // Collapse the chicken/layer/poultry aliases onto a single "poultry" type
  // so the analytics layer can sum poultry feed spend by a stable type.
  if (POULTRY_TYPES.has(trimmed)) return "poultry";
  return trimmed;
}

// Whether a (normalized or raw) feed type is poultry. Exported so the stats
// layer shares the exact same classification.
export function isPoultryType(value) {
  if (typeof value !== "string") return false;
  return POULTRY_TYPES.has(value.trim().toLowerCase());
}

// Normalizes an optional flock (coop id) tag. Returns the trimmed string, or
// undefined when absent so legacy rows stay untagged. The flock keys per-flock
// egg attribution; it matches the egg `coop` value.
function normalizeFlock(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
    throw new BadRequestError("flock must be a non-empty string (1-128 chars)");
  }
  return value.trim();
}

// Normalizes a purchasedAt/date value to an ISO timestamp. Empty -> now.
function normalizePurchasedAt(value) {
  if (value === undefined || value === null || value === "") {
    return new Date().toISOString();
  }
  if (typeof value !== "string" || isNaN(Date.parse(value))) {
    throw new BadRequestError("purchasedAt must be an ISO date or date-time string");
  }
  if (ISO_DATE_RE.test(value)) {
    return new Date(`${value}T00:00:00.000Z`).toISOString();
  }
  return new Date(value).toISOString();
}

// Validates the POST /feed-purchases body. Returns a clean fields object the
// domain layer turns into a row. Dispatches on `bags`: the new bag shape vs.
// the legacy quantity/unit shape. purchasedAt is normalized to an ISO
// timestamp so the sort key and gsi1sk order chronologically.
export function validateFeedPurchaseCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  if (body.bags !== undefined) {
    return validateBagPurchase(body);
  }
  return validateLegacyPurchase(body);
}

// New bag-based shape: { bags, bagWeightLbs, feedType, cost?, date? }.
// Stores bags, bagWeightLbs, totalLbs = bags * bagWeightLbs, plus the
// normalized feed type, cost (default 0), and purchasedAt.
function validateBagPurchase(body) {
  const { bags, bagWeightLbs, feedType, cost, date, purchasedAt, flock } = body;

  if (typeof bags !== "number" || !Number.isInteger(bags) || bags < 1) {
    throw new BadRequestError("bags must be an integer >= 1");
  }

  if (typeof bagWeightLbs !== "number" || !Number.isFinite(bagWeightLbs) || bagWeightLbs <= 0) {
    throw new BadRequestError("bagWeightLbs must be a positive number");
  }

  const normalizedType = normalizeType(feedType);

  let normalizedCost = 0;
  if (cost !== undefined && cost !== null) {
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
      throw new BadRequestError("cost must be a non-negative number");
    }
    normalizedCost = cost;
  }

  const totalLbs = bags * bagWeightLbs;

  return {
    type: normalizedType,
    feedType: normalizedType,
    bags,
    bagWeightLbs,
    totalLbs,
    cost: normalizedCost,
    flock: normalizeFlock(flock),
    purchasedAt: normalizePurchasedAt(date ?? purchasedAt),
  };
}

// Legacy shape: { quantity, unit, type, cost, vendor, purchasedAt }. Kept
// fully backward-compatible so existing clients keep working.
function validateLegacyPurchase(body) {
  const { type, quantity, unit, cost, vendor, purchasedAt, date, flock } = body;

  const normalizedType = normalizeType(type);

  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
    throw new BadRequestError("quantity must be a positive number");
  }

  if (typeof unit !== "string" || !UNITS.has(unit)) {
    throw new BadRequestError(`unit must be one of ${[...UNITS].join(", ")}`);
  }

  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
    throw new BadRequestError("cost must be a non-negative number");
  }

  if (typeof vendor !== "string" || vendor.trim().length === 0 || vendor.length > 128) {
    throw new BadRequestError("vendor is required (1-128 chars)");
  }

  return {
    type: normalizedType,
    quantity,
    unit,
    cost,
    vendor: vendor.trim(),
    flock: normalizeFlock(flock),
    purchasedAt: normalizePurchasedAt(purchasedAt ?? date),
  };
}

// Parses the GET /feed-purchases query string. `from`/`to` accept an ISO
// date (YYYY-MM-DD) or a month bucket (YYYY-MM); `type` is optional. The
// bounds come back as ISO timestamps so the domain layer can build the
// `PURCHASE#<ts>` sort-key range and the month fan-out list. `to` is made
// inclusive of the whole final day/month.
export function validateFeedPurchaseQuery(query = {}) {
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
    type: type === undefined ? undefined : normalizeType(type),
  };
}

// Converts a `from`/`to` bound into an ISO timestamp. `inclusiveEnd` pushes
// a date/month bound to the end of that day/month so a range like
// to=2026-06 covers all of June.
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
      // Last millisecond of the month: day 0 of next month.
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
// (pk/sk/gsi1*) never leak to clients. Bag fields are included only when the
// row was created via the bag shape so legacy rows round-trip unchanged.
export function formatFeedPurchase(row) {
  const out = {
    id: row.id,
    type: row.type,
    cost: row.cost,
    purchasedAt: row.purchasedAt,
    createdAt: row.createdAt,
  };

  if (row.bags !== undefined) {
    out.feedType = row.feedType ?? row.type;
    out.bags = row.bags;
    out.bagWeightLbs = row.bagWeightLbs;
    out.totalLbs = row.totalLbs;
  }

  if (row.quantity !== undefined) out.quantity = row.quantity;
  if (row.unit !== undefined) out.unit = row.unit;
  if (row.vendor !== undefined) out.vendor = row.vendor;
  // Per-flock attribution tag; included only when the row carries one so
  // legacy/untagged purchases round-trip unchanged.
  if (row.flock !== undefined) out.flock = row.flock;

  return out;
}
