import { BadRequestError } from "../services/errors.mjs";

// Validation + serialization for harvest logs. The create body takes a
// `harvestedAt`/`date` (YYYY-MM-DD or ISO date-time, defaults to today)
// normalized to an ISO timestamp so the sort key orders chronologically and
// the month bucket (pk) derives from the same value.

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YYYY_MM_RE = /^\d{4}-\d{2}$/;

// Units a harvest can be recorded in. `lb` is the canonical weight unit used
// by the produce-value tie-in (each/bunch are counted, not weighed).
export const HARVEST_UNITS = new Set(["lb", "oz", "each", "bunch"]);

function normalizeText(value, label, { required = false, max = 128 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new BadRequestError(`${label} is required`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new BadRequestError(`${label} must be a non-empty string (1-${max} chars)`);
  }
  return value.trim();
}

function normalizeHarvestedAt(value) {
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
  throw new BadRequestError("harvestedAt must be a YYYY-MM-DD or ISO date-time string");
}

// Validates the POST /harvest-logs body. Returns a clean fields object the
// domain layer turns into a row.
export function validateHarvestLogCreate(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const {
    cropName, variety, quantity, unit, harvestedAt, date,
    cropLibraryId, grnBedId, surplus,
  } = body;

  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
    throw new BadRequestError("quantity must be a positive number");
  }

  let normalizedUnit = "lb";
  if (unit !== undefined && unit !== null && unit !== "") {
    if (typeof unit !== "string" || !HARVEST_UNITS.has(unit.trim().toLowerCase())) {
      throw new BadRequestError(`unit must be one of ${[...HARVEST_UNITS].join(", ")}`);
    }
    normalizedUnit = unit.trim().toLowerCase();
  }

  let normalizedSurplus = false;
  if (surplus !== undefined && surplus !== null) {
    if (typeof surplus !== "boolean") {
      throw new BadRequestError("surplus must be a boolean");
    }
    normalizedSurplus = surplus;
  }

  return {
    cropName: normalizeText(cropName, "cropName", { required: true }),
    variety: normalizeText(variety, "variety"),
    quantity,
    unit: normalizedUnit,
    harvestedAt: normalizeHarvestedAt(harvestedAt ?? date),
    // Optional GRN linkage. cropLibraryId is the GRN grower-crop id (closes the
    // publish gap — see routes/harvest.mjs); grnBedId is the GRN garden-bed id.
    cropLibraryId: normalizeText(cropLibraryId, "cropLibraryId"),
    grnBedId: normalizeText(grnBedId, "grnBedId"),
    surplus: normalizedSurplus,
  };
}

// Parses the GET /harvest-logs query string. `from`/`to` accept an ISO date
// (YYYY-MM-DD) or a month bucket (YYYY-MM); bounds come back as ISO timestamps
// so the domain layer can build the `LOG#<ts>` sort-key range + month fan-out.
// `to` is inclusive of the whole final day/month.
export function validateHarvestLogQuery(query = {}) {
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
// leak to clients; GRN linkage fields surface as null when unset.
export function formatHarvestLog(row) {
  if (!row) return row;
  return {
    id: row.id,
    cropName: row.cropName,
    variety: row.variety ?? null,
    quantity: row.quantity,
    unit: row.unit,
    harvestedAt: row.harvestedAt,
    cropLibraryId: row.cropLibraryId ?? null,
    grnBedId: row.grnBedId ?? null,
    surplus: row.surplus ?? false,
    grnListingId: row.grnListingId ?? null,
    grnStatus: row.grnStatus ?? null,
    createdAt: row.createdAt,
  };
}
