import { BadRequestError } from "../services/errors.mjs";

// Validation + serialization for care tasks (recurring chores: worming,
// vaccinations, coop cleaning, etc.). The create body takes a title, category,
// optional target, and a cadenceDays interval. nextDueAt is computed in the
// domain layer (cadence days from creation) unless explicitly supplied.

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateCareTaskCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const { title, category, target, cadenceDays, nextDueAt } = body;

  if (typeof title !== "string" || title.trim().length === 0 || title.length > 200) {
    throw new BadRequestError("title is required (1-200 chars)");
  }

  if (typeof category !== "string" || category.trim().length === 0 || category.length > 64) {
    throw new BadRequestError("category is required (1-64 chars)");
  }

  if (typeof cadenceDays !== "number" || !Number.isInteger(cadenceDays) || cadenceDays < 1) {
    throw new BadRequestError("cadenceDays must be an integer >= 1");
  }

  return {
    title: title.trim(),
    category: category.trim().toLowerCase(),
    target: normalizeTarget(target),
    cadenceDays,
    nextDueAt: nextDueAt === undefined ? undefined : normalizeTimestamp(nextDueAt),
  };
}

// PATCH body: any subset of { title, category, target, cadenceDays }. At least
// one field is required. Returns only the provided (normalized) fields.
export function validateCareTaskUpdate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const out = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length === 0 || body.title.length > 200) {
      throw new BadRequestError("title must be a non-empty string (1-200 chars)");
    }
    out.title = body.title.trim();
  }

  if (body.category !== undefined) {
    if (typeof body.category !== "string" || body.category.trim().length === 0 || body.category.length > 64) {
      throw new BadRequestError("category must be a non-empty string (1-64 chars)");
    }
    out.category = body.category.trim().toLowerCase();
  }

  if (body.target !== undefined) {
    const target = normalizeTarget(body.target);
    if (target !== undefined) out.target = target;
  }

  if (body.cadenceDays !== undefined) {
    if (typeof body.cadenceDays !== "number" || !Number.isInteger(body.cadenceDays) || body.cadenceDays < 1) {
      throw new BadRequestError("cadenceDays must be an integer >= 1");
    }
    out.cadenceDays = body.cadenceDays;
  }

  if (Object.keys(out).length === 0) {
    throw new BadRequestError("at least one of title, category, target, cadenceDays is required");
  }

  return out;
}

// Parses ?withinDays for the care-due stats endpoint. Defaults to 7.
export function parseWithinDays(value, fallback = 7) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
    throw new BadRequestError("withinDays must be an integer between 1 and 3650");
  }
  return parsed;
}

function normalizeTarget(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
    throw new BadRequestError("target must be a non-empty string (1-128 chars)");
  }
  return value.trim();
}

function normalizeTimestamp(value) {
  if (typeof value === "string" && ISO_DATE_RE.test(value) && !isNaN(Date.parse(value))) {
    return new Date(`${value}T00:00:00.000Z`).toISOString();
  }
  if (typeof value === "string" && ISO_DATETIME_RE.test(value) && !isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new BadRequestError("nextDueAt must be a YYYY-MM-DD or ISO date-time string");
}

export function formatCareTask(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    target: row.target ?? null,
    cadenceDays: row.cadenceDays,
    lastDoneAt: row.lastDoneAt ?? null,
    nextDueAt: row.nextDueAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
