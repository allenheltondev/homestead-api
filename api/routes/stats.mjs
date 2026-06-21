import { jsonResponse } from "../services/http.mjs";
import { BadRequestError } from "../services/errors.mjs";
import {
  herdStats,
  pastureOccupancy,
  birthStats,
  deathStats,
  feedStats,
  feedInventory,
  eggStatsForPeriod,
  eggCostStats,
  eggCostByFlock,
  mortalityStats,
  healthStats,
  summaryStats,
  monthsForPeriod,
} from "../domain/stats.mjs";
import { composeWeeklyDigest } from "../domain/digest.mjs";
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

  // GET /stats/feed-inventory -- per-feedType on-hand lbs, value, burn rate,
  // and run-out forecast plus a `totals` object. Composes feed purchases
  // (lbs in) with feed consumption (lbs out); no Scans.
  app.get("/stats/feed-inventory", async () => {
    return jsonResponse(200, await feedInventory());
  });

  // GET /stats/eggs?period=YYYY-MM|YYYY -- total eggs, dozens, days, perDay.
  app.get("/stats/eggs", async ({ event }) => {
    const period = resolvePeriodString(event);
    const months = monthsForPeriod(period);
    if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    return jsonResponse(200, await eggStatsForPeriod(period, months));
  });

  // GET /stats/egg-cost/by-flock?period=&storePricePerDozen= -- per-flock
  // cost-per-dozen rows, grouping by the flocks (coops) seen in the period's
  // egg collections. Registered before /stats/egg-cost so the more specific
  // path always wins.
  app.get("/stats/egg-cost/by-flock", async ({ event }) => {
    const period = resolvePeriodString(event);
    const months = monthsForPeriod(period);
    if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    const storePricePerDozen = parseStorePrice(event);
    return jsonResponse(200, await eggCostByFlock(period, months, { storePricePerDozen }));
  });

  // GET /stats/egg-cost?period=&storePricePerDozen=&flock= -- cost-per-dozen
  // vs. the store price, on a poultry-feed basis. An optional `flock`
  // restricts eggs to coop==flock and poultry feed to flock==flock.
  app.get("/stats/egg-cost", async ({ event }) => {
    const period = resolvePeriodString(event);
    const months = monthsForPeriod(period);
    if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    const storePricePerDozen = parseStorePrice(event);
    const flock = parseFlock(event);
    return jsonResponse(200, await eggCostStats(period, months, { storePricePerDozen, flock }));
  });

  // GET /stats/mortality?period=YYYY-MM|YYYY -- total deaths, deaths by cause,
  // and an approximate loss rate over the active herd.
  app.get("/stats/mortality", async ({ event }) => {
    const period = resolvePeriodString(event);
    const months = monthsForPeriod(period);
    if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    return jsonResponse(200, await mortalityStats(period, months));
  });

  // GET /stats/health?period=YYYY-MM|YYYY -- total health spend, spend by
  // category, and a per-animal figure over the active herd.
  app.get("/stats/health", async ({ event }) => {
    const period = resolvePeriodString(event);
    const months = monthsForPeriod(period);
    if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    return jsonResponse(200, await healthStats(period, months));
  });

  // GET /stats/digest -- the on-demand weekly digest payload (the same shape
  // the scheduled digest function composes).
  app.get("/stats/digest", async () => {
    return jsonResponse(200, await composeWeeklyDigest());
  });

  // GET /stats/summary -- one speakable payload composing the above.
  app.get("/stats/summary", async () => {
    return jsonResponse(200, await summaryStats());
  });
}

// Parses ?flock into a non-empty string, or undefined when absent so the
// domain layer keeps its no-flock (legacy) behavior.
function parseFlock(event) {
  const raw = event?.queryStringParameters?.flock;
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new BadRequestError("flock must be a non-empty string");
  }
  return raw.trim();
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
