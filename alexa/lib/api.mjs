// Thin HTTP client for the Homestead REST API, used by the Alexa skill's
// intent handlers. It calls the same Cognito-authorized API the dashboard
// uses, forwarding the account-linked user's token in the Authorization
// header.
//
// The token comes from Alexa account linking
// (handlerInput.requestEnvelope.context.System.user.accessToken). The API's
// Lambda authorizer verifies a Cognito *id* token (aud == app client id), so
// the Alexa app client / account-linking config must yield a token the
// authorizer accepts — see docs/ALEXA.md.

const API_BASE_URL = process.env.API_BASE_URL;

// Raised when the API responds with a non-2xx status. Carries the status so
// handlers can distinguish auth failures (401/403) from everything else and
// speak an appropriate prompt.
export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// Raised when the request has no account-linking token. Handlers map this to
// the "please link your account" prompt with a LinkAccount card.
export class MissingTokenError extends Error {
  constructor(message = "No account-linking token present") {
    super(message);
    this.name = "MissingTokenError";
  }
}

// Pulls the account-linking access token off the request envelope. Returns
// undefined when the user has not linked their account.
export function tokenFromRequest(handlerInput) {
  return handlerInput?.requestEnvelope?.context?.System?.user?.accessToken;
}

function joinUrl(base, path) {
  if (!base) throw new Error("API_BASE_URL env var must be set");
  const trimmedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

// Performs an authorized request against the API and returns the parsed JSON
// body (or null for 204). Throws MissingTokenError when unlinked and ApiError
// on a non-2xx response.
async function request(token, method, path, body) {
  if (!token) throw new MissingTokenError();

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(joinUrl(API_BASE_URL, path), init);

  if (res.status === 204) return null;

  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const message =
      (payload && typeof payload === "object" && payload.message) ||
      `API request failed with status ${res.status}`;
    throw new ApiError(res.status, message, payload);
  }

  return payload;
}

// Builds an API client bound to a single request's account-linking token.
// Each method maps 1:1 to an API endpoint the skill needs.
export function createApiClient(handlerInput) {
  const token = tokenFromRequest(handlerInput);
  return {
    // GET /stats/summary — speakable rollup (herd, births/deaths, feed).
    getSummary: () => request(token, "GET", "/stats/summary"),
    // GET /stats/herd — counts by species and status.
    getHerd: () => request(token, "GET", "/stats/herd"),
    // POST /births — create an animal + BIRTH event.
    recordBirth: (fields) => request(token, "POST", "/births", fields),
    // POST /feed-purchases — record a feed purchase.
    recordFeedPurchase: (fields) =>
      request(token, "POST", "/feed-purchases", fields),
  };
}
