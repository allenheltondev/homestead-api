import { BadRequestError } from "../services/errors.mjs";

// Validation + formatting for the Pasture entity. Throws BadRequestError
// on any rule violation so route handlers let it propagate to the
// http-handler's error mapper.

const NAME_MAX = 200;
const NOTES_MAX = 2000;
const ACREAGE_MAX = 1_000_000;

// Validates a POST /pastures body. name is required; acreage and notes
// are optional.
export function validatePasturePayload(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const out = {};
  const { name, acreage, notes } = body;

  if (typeof name !== "string" || name.trim().length === 0) {
    throw new BadRequestError("name is required and must be a non-empty string");
  }
  if (name.length > NAME_MAX) {
    throw new BadRequestError(`name exceeds ${NAME_MAX} chars`);
  }
  out.name = name.trim();

  if (acreage !== undefined && acreage !== null) {
    if (typeof acreage !== "number" || !Number.isFinite(acreage) || acreage < 0) {
      throw new BadRequestError("acreage must be a non-negative number");
    }
    if (acreage > ACREAGE_MAX) {
      throw new BadRequestError(`acreage exceeds ${ACREAGE_MAX}`);
    }
    out.acreage = acreage;
  }

  if (notes !== undefined && notes !== null) {
    if (typeof notes !== "string" || notes.length > NOTES_MAX) {
      throw new BadRequestError(`notes must be a string up to ${NOTES_MAX} chars`);
    }
    out.notes = notes;
  }

  return out;
}

export function formatPasture(row) {
  return {
    id: row.id,
    name: row.name,
    acreage: row.acreage ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Shapes an animal->pasture pointer item (sk = PASTURE) into the
// occupancy view returned by GET /pastures/{id}/animals.
export function formatPastureAnimal(row) {
  return {
    animalId: row.animalId,
    pastureId: row.toPastureId,
    movedAt: row.ts ?? null,
  };
}
