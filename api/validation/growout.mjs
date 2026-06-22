import { BadRequestError } from "../services/errors.mjs";

// Validation + serialization for grow-out batches (meat birds / market
// animals raised to a processing date). The create body takes a species,
// count, purpose, and a `startedAt` date (defaults to now). The process body
// records a processedAt, total dressed weight, and processed count.

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateGrowoutCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const { species, count, purpose, startedAt, date } = body;

  if (typeof species !== "string" || species.trim().length === 0 || species.length > 64) {
    throw new BadRequestError("species is required (1-64 chars)");
  }

  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
    throw new BadRequestError("count must be an integer >= 1");
  }

  if (typeof purpose !== "string" || purpose.trim().length === 0 || purpose.length > 64) {
    throw new BadRequestError("purpose is required (1-64 chars)");
  }

  return {
    species: species.trim().toLowerCase(),
    count,
    purpose: purpose.trim().toLowerCase(),
    startedAt: normalizeTimestamp(startedAt ?? date),
  };
}

// Process body: { dressedWeightLbsTotal, processedCount?, processedAt? }.
// processedCount defaults to nothing (left null) when omitted.
export function validateGrowoutProcess(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const { dressedWeightLbsTotal, processedCount, processedAt, date } = body;

  if (
    typeof dressedWeightLbsTotal !== "number"
    || !Number.isFinite(dressedWeightLbsTotal)
    || dressedWeightLbsTotal < 0
  ) {
    throw new BadRequestError("dressedWeightLbsTotal must be a non-negative number");
  }

  let normalizedProcessedCount;
  if (processedCount !== undefined && processedCount !== null && processedCount !== "") {
    if (typeof processedCount !== "number" || !Number.isInteger(processedCount) || processedCount < 0) {
      throw new BadRequestError("processedCount must be an integer >= 0");
    }
    normalizedProcessedCount = processedCount;
  }

  return {
    dressedWeightLbsTotal,
    processedCount: normalizedProcessedCount,
    processedAt: normalizeTimestamp(processedAt ?? date),
  };
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
  throw new BadRequestError("date must be a YYYY-MM-DD or ISO date-time string");
}

export function formatGrowout(row) {
  return {
    id: row.id,
    species: row.species,
    count: row.count,
    purpose: row.purpose,
    startedAt: row.startedAt,
    status: row.status,
    processedAt: row.processedAt ?? null,
    dressedWeightLbsTotal: row.dressedWeightLbsTotal ?? null,
    processedCount: row.processedCount ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
