// Typed errors that route + domain handlers throw to signal API
// responses. The http-handler wrapper catches them and maps to status
// codes so route code stays declarative ("throw new NotFoundError('animal', id)").

export class ApiError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code ?? this.constructor.name;
  }
}

export class BadRequestError extends ApiError {
  constructor(message) {
    super(400, message, "BadRequest");
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Unauthorized") {
    super(401, message, "Unauthorized");
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden") {
    super(403, message, "Forbidden");
  }
}

export class NotFoundError extends ApiError {
  constructor(entity, id) {
    super(404, `${entity} ${id} not found`, "NotFound");
  }
}

export class ConflictError extends ApiError {
  constructor(message) {
    super(409, message, "Conflict");
  }
}

export class UpstreamError extends ApiError {
  constructor(message, upstreamStatus) {
    super(502, message, "UpstreamError");
    this.upstreamStatus = upstreamStatus;
  }
}

// --- Good Roots Network (GRN) integration errors ------------------------
// GRN is an optional outbound integration: it is only reachable when a base
// URL + an SSM-stored bearer token are configured. These typed errors let the
// GRN client + routes signal the three distinct failure modes cleanly.

// The GRN integration is not configured (missing base URL or token). Surfaced
// as a 503 so callers can tell "not wired up" apart from a real upstream error.
export class GrnNotConfiguredError extends ApiError {
  constructor(message = "Good Roots Network integration is not configured") {
    super(503, message, "GrnNotConfigured");
  }
}

// GRN rejected our credentials (upstream 401/403). Surfaced as a 502 (an
// upstream/config problem on our side, not the caller's) carrying the upstream
// status for diagnostics.
export class GrnUnauthorizedError extends ApiError {
  constructor(upstreamStatus, message = "Good Roots Network rejected the request credentials") {
    super(502, message, "GrnUnauthorized");
    this.upstreamStatus = upstreamStatus;
  }
}
