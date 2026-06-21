import { BadRequestError } from "./errors.mjs";

// Request/response helpers shared by route handlers. `jsonResponse` is
// re-exported from http-handler.mjs (the single source of truth for the
// JSON + CORS response shape) so routes can pull everything they need
// for an HTTP response from one module.
export { jsonResponse, emptyResponse } from "./http-handler.mjs";

// Parses an API Gateway proxy event body into an object. Route handlers
// receive the Powertools Router context whose `.event` is the raw proxy
// event; pass that event in. Throws a BadRequestError (-> 400) on
// malformed JSON so a bad client body never becomes a 500.
export function parseBody(event) {
  const raw = event?.body;
  if (raw === undefined || raw === null || raw === "") return {};
  let text = raw;
  if (event?.isBase64Encoded) {
    text = Buffer.from(raw, "base64").toString("utf8");
  }
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("body did not decode to an object");
    }
    return parsed;
  } catch {
    throw new BadRequestError("request body is not valid JSON");
  }
}

// Validates a `limit` query-string value. Returns a sane default when
// absent and rejects out-of-range/non-integer values with a 400 so the
// Query's Limit is always trustworthy.
export function parseLimit(rawLimit, { defaultValue = 100, max = 500 } = {}) {
  if (rawLimit === undefined || rawLimit === null || rawLimit === "") return defaultValue;
  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new BadRequestError(`limit must be an integer between 1 and ${max}`);
  }
  return parsed;
}
