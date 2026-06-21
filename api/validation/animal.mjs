import { BadRequestError } from "../services/errors.mjs";

// Validation for the animal + lifecycle endpoints. Each function returns a
// normalized field bag (camelCase) for the domain layer; route handlers stay
// thin and never touch raw request shapes directly. Throwing BadRequestError
// keeps a malformed client body a 400 rather than a 500.

const SEXES = new Set(["female", "male", "unknown"]);
const STATUSES = new Set(["active", "sold", "deceased"]);
// ULIDs are Crockford base32, 26 chars. Ids are generated server-side, but
// damId/sireId/pasture references come from clients and must be validated.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const NAME_MAX = 200;
const SPECIES_MAX = 80;
const BREED_MAX = 120;
const TAG_MAX = 80;
const CAUSE_MAX = 500;

export { STATUSES as ANIMAL_STATUSES, ULID_RE };

function requireObject(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }
}

function validateSpecies(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestError("species is required");
  }
  if (value.length > SPECIES_MAX) {
    throw new BadRequestError(`species exceeds ${SPECIES_MAX} chars`);
  }
  return value.trim();
}

function validateOptionalString(value, field, max) {
  if (typeof value !== "string" || value.length > max) {
    throw new BadRequestError(`${field} must be a string up to ${max} chars`);
  }
  return value;
}

function validateSex(value) {
  if (!SEXES.has(value)) {
    throw new BadRequestError(`sex must be one of ${[...SEXES].join(", ")}`);
  }
  return value;
}

function validateDob(value) {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
    throw new BadRequestError("dob must be YYYY-MM-DD");
  }
  return value;
}

function validatePastureId(value) {
  if (typeof value !== "string" || !ULID_RE.test(value)) {
    throw new BadRequestError("pasture must be a ULID");
  }
  return value;
}

// POST /animals — species required, everything else optional. status defaults
// to "active". `name` and `tag` are interchangeable display identifiers; at
// least one is conventionally supplied but neither is strictly required.
export function validateAnimalCreate(body) {
  requireObject(body);
  const { species, breed, name, tag, sex, dob, status, pasture } = body;

  const out = { species: validateSpecies(species) };

  if (breed !== undefined && breed !== null && breed !== "") {
    out.breed = validateOptionalString(breed, "breed", BREED_MAX);
  }
  if (name !== undefined && name !== null && name !== "") {
    out.name = validateOptionalString(name, "name", NAME_MAX);
  }
  if (tag !== undefined && tag !== null && tag !== "") {
    out.tag = validateOptionalString(tag, "tag", TAG_MAX);
  }
  if (sex !== undefined && sex !== null) {
    out.sex = validateSex(sex);
  }
  if (dob !== undefined && dob !== null && dob !== "") {
    out.dob = validateDob(dob);
  }
  if (status !== undefined) {
    if (!STATUSES.has(status)) {
      throw new BadRequestError(`status must be one of ${[...STATUSES].join(", ")}`);
    }
    out.status = status;
  } else {
    out.status = "active";
  }
  if (pasture !== undefined && pasture !== null && pasture !== "") {
    out.pasture = validatePastureId(pasture);
  }

  return out;
}

// PATCH /animals/{id} — every field optional; only present fields are applied.
// Status changes that are lifecycle transitions (deceased/sold) should go
// through the dedicated death/sale endpoints, but a plain status edit is still
// allowed here for corrections.
export function validateAnimalUpdate(body) {
  requireObject(body);
  const { breed, name, tag, sex, dob, status } = body;
  const out = {};

  if (breed !== undefined && breed !== null && breed !== "") {
    out.breed = validateOptionalString(breed, "breed", BREED_MAX);
  }
  if (name !== undefined && name !== null && name !== "") {
    out.name = validateOptionalString(name, "name", NAME_MAX);
  }
  if (tag !== undefined && tag !== null && tag !== "") {
    out.tag = validateOptionalString(tag, "tag", TAG_MAX);
  }
  if (sex !== undefined && sex !== null) {
    out.sex = validateSex(sex);
  }
  if (dob !== undefined && dob !== null && dob !== "") {
    out.dob = validateDob(dob);
  }
  if (status !== undefined) {
    if (!STATUSES.has(status)) {
      throw new BadRequestError(`status must be one of ${[...STATUSES].join(", ")}`);
    }
    out.status = status;
  }

  if (Object.keys(out).length === 0) {
    throw new BadRequestError("no updatable fields supplied");
  }

  return out;
}

// Query-string filters for GET /animals. Mutually-permissive; the route picks
// the index based on which filter is present (species -> GSI1, status/list ->
// GSI2, pasture -> GSI1 pointer partition).
export function validateAnimalListQuery(qs = {}) {
  const out = {};
  const { species, status, pasture } = qs ?? {};

  if (species !== undefined && species !== null && species !== "") {
    out.species = validateSpecies(species);
  }
  if (status !== undefined && status !== null && status !== "") {
    if (!STATUSES.has(status)) {
      throw new BadRequestError(`status must be one of ${[...STATUSES].join(", ")}`);
    }
    out.status = status;
  }
  if (pasture !== undefined && pasture !== null && pasture !== "") {
    out.pasture = validatePastureId(pasture);
  }

  return out;
}

// POST /births — creates an animal AND a BIRTH lifecycle event. Reuses the
// create validation for the animal fields, then layers on the optional
// parentage links and an optional birth date/timestamp.
export function validateBirth(body) {
  requireObject(body);
  const animal = validateAnimalCreate(body);

  const out = { animal };

  if (body.damId !== undefined && body.damId !== null && body.damId !== "") {
    if (typeof body.damId !== "string" || !ULID_RE.test(body.damId)) {
      throw new BadRequestError("damId must be a ULID");
    }
    out.damId = body.damId;
  }
  if (body.sireId !== undefined && body.sireId !== null && body.sireId !== "") {
    if (typeof body.sireId !== "string" || !ULID_RE.test(body.sireId)) {
      throw new BadRequestError("sireId must be a ULID");
    }
    out.sireId = body.sireId;
  }
  // A born animal is alive — refuse a contradictory status up front.
  if (animal.status !== "active") {
    throw new BadRequestError("a birth must create an active animal");
  }

  return out;
}

// POST /animals/{id}/death — records cause + date and flips status to deceased.
export function validateDeath(body) {
  requireObject(body);
  const { date, cause } = body;
  const out = {};

  if (date !== undefined && date !== null && date !== "") {
    out.date = validateDob(date);
  }
  if (cause !== undefined && cause !== null && cause !== "") {
    out.cause = validateOptionalString(cause, "cause", CAUSE_MAX);
  }

  return out;
}

// POST /animals/{id}/sale — records sale details and flips status to sold.
export function validateSale(body) {
  requireObject(body);
  const { date, buyer, price } = body;
  const out = {};

  if (date !== undefined && date !== null && date !== "") {
    out.date = validateDob(date);
  }
  if (buyer !== undefined && buyer !== null && buyer !== "") {
    out.buyer = validateOptionalString(buyer, "buyer", NAME_MAX);
  }
  if (price !== undefined && price !== null) {
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      throw new BadRequestError("price must be a non-negative number");
    }
    out.price = price;
  }

  return out;
}
