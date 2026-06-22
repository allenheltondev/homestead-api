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
    // POST /deaths — record an animal death.
    recordDeath: (fields) => request(token, "POST", "/deaths", fields),
    // POST /moves — move a group of animals to a pasture.
    moveAnimals: (fields) => request(token, "POST", "/moves", fields),
    // POST /feed-purchases — record a feed purchase. The body carries bags +
    // per-bag weight; the server computes the total weight.
    recordFeedPurchase: (fields) =>
      request(token, "POST", "/feed-purchases", fields),
    // POST /egg-collections — log an egg collection.
    recordEggCollection: (fields) =>
      request(token, "POST", "/egg-collections", fields),
    // POST /feed-consumption — log feed fed to the animals so the server can
    // draw down on-hand inventory.
    recordFeedUsage: (fields) =>
      request(token, "POST", "/feed-consumption", fields),
    // GET /stats/feed-inventory — on-hand feed and projected run-out, optionally
    // filtered to a single feed type.
    getFeedInventory: (feedType) =>
      request(
        token,
        "GET",
        feedType
          ? `/stats/feed-inventory?feedType=${encodeURIComponent(feedType)}`
          : "/stats/feed-inventory",
      ),
    // GET /stats/eggs — egg collection stats for an optional period.
    getEggStats: (query) =>
      request(token, "GET", joinQuery("/stats/eggs", query)),
    // GET /stats/egg-cost — cost-per-dozen vs store price for an optional
    // period and an optional flock (coop) filter.
    getEggCost: (query) =>
      request(token, "GET", joinQuery("/stats/egg-cost", query)),
    // POST /health-expenses — record a vet/medicine/supplies expense.
    recordHealthExpense: (fields) =>
      request(token, "POST", "/health-expenses", fields),
    // GET /stats/health — health-expense spend for an optional period.
    getHealthStats: (query) =>
      request(token, "GET", joinQuery("/stats/health", query)),
    // GET /stats/mortality — loss/death stats for an optional period.
    getMortality: (query) =>
      request(token, "GET", joinQuery("/stats/mortality", query)),
    // GET /stats/digest — weekly homestead digest (speakable `lines`).
    getDigest: () => request(token, "GET", "/stats/digest"),

    // --- Species-smart animals: milk logging + stats ---------------------
    // POST /milk-logs — log a milking (volume + unit, optional animal/date).
    recordMilk: (fields) => request(token, "POST", "/milk-logs", fields),
    // GET /stats/milk — milk production stats for an optional period.
    getMilkStats: (query) =>
      request(token, "GET", joinQuery("/stats/milk", query)),
    // GET /stats/milk-cost — cost-per-gallon (or per-unit) vs store price for
    // an optional period.
    getMilkCost: (query) =>
      request(token, "GET", joinQuery("/stats/milk-cost", query)),

    // --- Care schedules --------------------------------------------------
    // GET /care-tasks — the full list of care tasks (optionally filtered).
    getCareTasks: (query) =>
      request(token, "GET", joinQuery("/care-tasks", query)),
    // GET /stats/care/due — care tasks coming due within N days (default
    // window decided by the server when withinDays is omitted).
    getCareDue: (withinDays) =>
      request(
        token,
        "GET",
        withinDays != null
          ? `/stats/care/due?withinDays=${encodeURIComponent(withinDays)}`
          : "/stats/care/due",
      ),
    // POST /care-tasks/{id}/complete — mark a care task complete.
    completeCareTask: (id) =>
      request(
        token,
        "POST",
        `/care-tasks/${encodeURIComponent(id)}/complete`,
      ),

    // --- Breeding / incubation upcoming ----------------------------------
    // GET /stats/breeding/upcoming — kiddings/calvings/etc. coming due within
    // N days. GET /stats/incubation — hatches in progress. getUpcomingDue
    // fans out to both and returns a merged shape the speech layer renders.
    getBreedingUpcoming: (withinDays) =>
      request(
        token,
        "GET",
        withinDays != null
          ? `/stats/breeding/upcoming?withinDays=${encodeURIComponent(withinDays)}`
          : "/stats/breeding/upcoming",
      ),
    getIncubation: () => request(token, "GET", "/stats/incubation"),
    // Combined "what's due to hatch or kid" rollup. Resolves both calls and
    // returns { breeding, incubation }; either may be null if its call fails.
    getUpcomingDue: async (withinDays) => {
      const [breeding, incubation] = await Promise.all([
        request(
          token,
          "GET",
          withinDays != null
            ? `/stats/breeding/upcoming?withinDays=${encodeURIComponent(withinDays)}`
            : "/stats/breeding/upcoming",
        ),
        request(token, "GET", "/stats/incubation"),
      ]);
      return { breeding, incubation };
    },

    // --- Homestead P&L ---------------------------------------------------
    // GET /stats/pnl — profit-and-loss (income, expenses, net) for an
    // optional period.
    getPnl: (query) => request(token, "GET", joinQuery("/stats/pnl", query)),

    // --- Garden pillar + Good Roots Network (GRN) ------------------------
    // POST /harvest-logs — log a garden harvest (crop + quantity + unit,
    // optional date). The server returns the created harvest log.
    recordHarvest: (fields) => request(token, "POST", "/harvest-logs", fields),
    // GET /stats/garden — garden harvest stats for an optional period.
    getGardenStats: (query) =>
      request(token, "GET", joinQuery("/stats/garden", query)),
    // GET /garden/calendar — the planting/sowing calendar for the homestead.
    getPlantingCalendar: () => request(token, "GET", "/garden/calendar"),
    // POST /harvest-logs/{id}/publish — share surplus from a harvest log to
    // the Good Roots Network as a listing other members can claim.
    publishSurplus: (id, fields) =>
      request(
        token,
        "POST",
        `/harvest-logs/${encodeURIComponent(id)}/publish`,
        fields,
      ),
    // GET /grn/my-listings — the member's surplus listings on the Good Roots
    // Network, including each listing's claim status.
    getGrnListings: () => request(token, "GET", "/grn/my-listings"),
    // GET /grn/requests — community needs/requests posted to the Good Roots
    // Network that the member could fill.
    getGrnRequests: () => request(token, "GET", "/grn/requests"),
  };
}

// Appends a query string to a path from the keys we support ({ period, flock }),
// skipping any that aren't set. Returns the bare path when nothing applies.
function joinQuery(path, query) {
  if (!query) return path;
  const params = new URLSearchParams();
  if (query.period) params.set("period", query.period);
  if (query.flock) params.set("flock", query.flock);
  if (query.withinDays != null) params.set("withinDays", query.withinDays);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
