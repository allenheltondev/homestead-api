import { BadRequestError } from "../services/errors.mjs";

// Validation + serialization for feed purchases. Route handlers stay thin
// by delegating shape-checking here and formatting stored rows on the way
// out. Types are free-form strings (e.g. "hay", "grain") but normalized to
// lower case so the GSI1 `FEED#<type>` partition is stable regardless of
// how the client cased the input.

const UNITS = new Set(["lb", "kg", "ton", "bag", "bale", "flake"]);

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
  return trimmed;
}

// Validates the POST /feed-purchases body. Returns a clean fields object
// the domain layer turns into a row; purchasedAt is normalized to an ISO
// timestamp so the sort key and gsi1sk order chronologically.
export function validateFeedPurchaseCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const { type, quantity, unit, cost, vendor, purchasedAt } = body;

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

  let purchasedAtIso;
  if (purchasedAt === undefined || purchasedAt === null || purchasedAt === "") {
    purchasedAtIso = new Date().toISOString();
  } else {
    if (typeof purchasedAt !== "string" || isNaN(Date.parse(purchasedAt))) {
      throw new BadRequestError("purchasedAt must be an ISO date or date-time string");
    }
    purchasedAtIso = new Date(purchasedAt).toISOString();
  }

  return {
    type: normalizedType,
    quantity,
    unit,
    cost,
    vendor: vendor.trim(),
    purchasedAt: purchasedAtIso,
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
// (pk/sk/gsi1*) never leak to clients.
export function formatFeedPurchase(row) {
  return {
    id: row.id,
    type: row.type,
    quantity: row.quantity,
    unit: row.unit,
    cost: row.cost,
    vendor: row.vendor,
    purchasedAt: row.purchasedAt,
    createdAt: row.createdAt,
  };
}
