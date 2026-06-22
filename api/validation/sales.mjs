import { BadRequestError } from "../services/errors.mjs";

// Validation + serialization for sales records (revenue line items feeding the
// P&L). The create body takes an item label, an amount, an optional quantity,
// and a `soldAt` date (defaults to today) normalized to an ISO timestamp so
// the sort key orders chronologically and the month bucket (pk) derives from
// the same value.

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YYYY_MM_RE = /^\d{4}-\d{2}$/;

export function validateSaleCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const { item, amount, quantity, soldAt, date } = body;

  if (typeof item !== "string" || item.trim().length === 0 || item.length > 200) {
    throw new BadRequestError("item is required (1-200 chars)");
  }

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    throw new BadRequestError("amount must be a non-negative number");
  }

  let normalizedQuantity;
  if (quantity !== undefined && quantity !== null && quantity !== "") {
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestError("quantity must be a positive number");
    }
    normalizedQuantity = quantity;
  }

  return {
    item: item.trim(),
    amount,
    quantity: normalizedQuantity,
    soldAt: normalizeSoldAt(soldAt ?? date),
  };
}

function normalizeSoldAt(value) {
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

// Parses the GET /sales query string. `from`/`to` accept an ISO date or a
// month bucket; bounds come back as ISO timestamps. `to` is inclusive of the
// whole final day/month.
export function validateSaleQuery(query = {}) {
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

export function formatSale(row) {
  return {
    id: row.id,
    item: row.item,
    amount: row.amount,
    quantity: row.quantity ?? null,
    soldAt: row.soldAt,
    createdAt: row.createdAt,
  };
}
