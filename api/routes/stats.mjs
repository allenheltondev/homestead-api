import { jsonResponse } from "../services/http.mjs";
import { BadRequestError } from "../services/errors.mjs";
import {
  herdStats,
  pastureOccupancy,
  birthStats,
  deathStats,
  feedStats,
  eggStatsForPeriod,
  eggCostStats,
  summaryStats,
  monthsForPeriod,
} from "../domain/stats.mjs";
import { yyyymm } from "../services/time.mjs";

// Read-only stats & reporting routes. Handlers stay thin: parse/validate
// the period, delegate to the domain aggregation, and shape the response.
// All aggregation (and the no-Scan Query access patterns) lives in
// api/domain/stats.mjs.
export function registerStatsRoutes(app) {
  // GET /stats/herd -- counts by species and status.
  app.get("/stats/herd", async () => {
    return jsonResponse(200, await herdStats());
  });

  // GET /stats/pastures -- current occupancy per pasture.
  app.get("/stats/pastures", async () => {
    return jsonResponse(200, await pastureOccupancy());
  });

  // GET /stats/births?period=YYYY-MM|YYYY
  app.get("/stats/births", async ({ event }) => {
    const months = resolvePeriod(event);
    return jsonResponse(200, await birthStats(months));
  });

  // GET /stats/deaths?period=YYYY-MM|YYYY
  app.get("/stats/deaths", async ({ event }) => {
    const months = resolvePeriod(event);
    return jsonResponse(200, await deathStats(months));
  });

  // GET /stats/feed?period=YYYY-MM|YYYY -- total spend + quantity by type.
  app.get("/stats/feed", async ({ event }) => {
    const months = resolvePeriod(event);
    return jsonResponse(200, await feedStats(months));
  });

  // GET /stats/eggs?period=YYYY-MM|YYYY -- total eggs, dozens, days, perDay.
  app.get("/stats/eggs", async ({ event }) => {
    const period = resolvePeriodString(event);
    const months = monthsForPeriod(period);
    if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    return jsonResponse(200, await eggStatsForPeriod(period, months));
  });

  // GET /stats/egg-cost?period=&storePricePerDozen= -- cost-per-dozen vs.
  // the store price, on a poultry-feed basis.
  app.get("/stats/egg-cost", async ({ event }) => {
    const period = resolvePeriodString(event);
    const months = monthsForPeriod(period);
    if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    const storePricePerDozen = parseStorePrice(event);
    return jsonResponse(200, await eggCostStats(period, months, { storePricePerDozen }));
  });

  // GET /stats/summary -- one speakable payload composing the above.
  app.get("/stats/summary", async () => {
    return jsonResponse(200, await summaryStats());
  });
}

// Reads ?period from the query string, defaulting to the current month, and
// returns it as a string (callers expand it via monthsForPeriod and echo it
// back in the response).
function resolvePeriodString(event) {
  return event?.queryStringParameters?.period ?? yyyymm();
}

// Parses ?storePricePerDozen into a non-negative float, or undefined when
// absent so the domain layer falls back to the env default.
function parseStorePrice(event) {
  const raw = event?.queryStringParameters?.storePricePerDozen;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestError("storePricePerDozen must be a non-negative number");
  }
  return parsed;
}

// Reads ?period from the query string, defaulting to the current month.
// Expands it to the list of month buckets the aggregation queries, or
// throws a 400 BadRequest if the format is invalid.
function resolvePeriod(event) {
  const period = event?.queryStringParameters?.period ?? yyyymm();
  const months = monthsForPeriod(period);
  if (!months) {
    throw new BadRequestError("period must be YYYY-MM or YYYY");
  }
  return months;
}
