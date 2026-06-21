import { BadRequestError } from "../services/errors.mjs";

// Validation + formatting for animal move events. A move records an
// animal entering a pasture at a timestamp.

const NOTES_MAX = 2000;

// Validates a POST /animals/{id}/moves body. toPastureId is required;
// ts (ISO-8601) and notes are optional.
export function validateMovePayload(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("request body must be a JSON object");
  }

  const out = {};
  const { toPastureId, ts, notes } = body;

  if (typeof toPastureId !== "string" || toPastureId.trim().length === 0) {
    throw new BadRequestError("toPastureId is required and must be a non-empty string");
  }
  out.toPastureId = toPastureId.trim();

  if (ts !== undefined && ts !== null) {
    if (typeof ts !== "string" || Number.isNaN(Date.parse(ts))) {
      throw new BadRequestError("ts must be an ISO-8601 timestamp string");
    }
    out.ts = new Date(ts).toISOString();
  }

  if (notes !== undefined && notes !== null) {
    if (typeof notes !== "string" || notes.length > NOTES_MAX) {
      throw new BadRequestError(`notes must be a string up to ${NOTES_MAX} chars`);
    }
    out.notes = notes;
  }

  return out;
}

export function formatMove(row) {
  return {
    animalId: row.animalId,
    fromPastureId: row.fromPastureId ?? null,
    toPastureId: row.toPastureId,
    ts: row.ts,
    notes: row.notes ?? null,
  };
}
