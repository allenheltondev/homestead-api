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
  milkStats,
  milkCostStats,
  incubationStats,
  growoutStats,
  pnlStats,
} from "../domain/stats.mjs";
import { listBreedingsDue } from "../domain/breeding.mjs";
import { listCareTasksDue } from "../domain/careTask.mjs";
import { formatBreeding, parseWithinDays as parseBreedingWithinDays } from "../validation/breeding.mjs";
import { formatCareTask, parseWithinDays as parseCareWithinDays } from "../validation/careTask.mjs";
import { parseBirdTypeFilter } from "../validation/eggs.mjs";
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

  // GET /stats/eggs?period=YYYY-MM|YYYY&birdType= -- total eggs, dozens, days,
  // perDay, plus a byBirdType breakdown. An optional birdType restricts the
  // totals to one bird type; omitting it keeps the original behavior.
  app.get("/stats/eggs", async ({ event }) => {
    const period = resolvePeriodString(event);
    const months = monthsForPeriod(period);
    if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    const birdType = parseBirdTypeFilter(event?.queryStringParameters?.birdType);
    return jsonResponse(200, await eggStatsForPeriod(period, months, { birdType }));
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
    const birdType = parseBirdTypeFilter(event?.queryStringParameters?.birdType);
    return jsonResponse(
      200,
      await eggCostStats(period, months, { storePricePerDozen, flock, birdType }),
    );
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

  // GET /stats/milk?period=YYYY-MM|YYYY -- total gallons, per-animal, per-day.
  app.get("/stats/milk", async ({ event }) => {
    const period = resolvePeriodString(event);
    const months = monthsForPeriod(period);
    if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    return jsonResponse(200, await milkStats(period, months));
  });

  // GET /stats/milk-cost?period=&milkPricePerGallon= -- goat-feed cost per
  // gallon vs. a market price (mirrors /stats/egg-cost).
  app.get("/stats/milk-cost", async ({ event }) => {
    const period = resolvePeriodString(event);
    const months = monthsForPeriod(period);
    if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    const milkPricePerGallon = parsePrice(event, "milkPricePerGallon");
    return jsonResponse(200, await milkCostStats(period, months, { milkPricePerGallon }));
  });

  // GET /stats/incubation -- active batches + overall hatch rate.
  app.get("/stats/incubation", async () => {
    return jsonResponse(200, await incubationStats());
  });

  // GET /stats/growout?period=YYYY-MM|YYYY -- active + processed yield lbs,
  // plus an optional feed cost-to-raise when a period is supplied.
  app.get("/stats/growout", async ({ event }) => {
    const periodRaw = event?.queryStringParameters?.period;
    let months;
    if (periodRaw !== undefined && periodRaw !== null && periodRaw !== "") {
      months = monthsForPeriod(periodRaw);
      if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    }
    return jsonResponse(200, await growoutStats(months));
  });

  // GET /stats/breeding/upcoming?withinDays= -- breedings due within N days.
  app.get("/stats/breeding/upcoming", async ({ event }) => {
    const withinDays = parseBreedingWithinDays(event?.queryStringParameters?.withinDays);
    const items = await listBreedingsDue(withinDays);
    return jsonResponse(200, {
      withinDays,
      breedings: items.map(formatBreeding),
    });
  });

  // GET /stats/care/due?withinDays= -- care tasks due within N days (defaults
  // to 7; includes overdue tasks).
  app.get("/stats/care/due", async ({ event }) => {
    const withinDays = parseCareWithinDays(event?.queryStringParameters?.withinDays);
    const items = await listCareTasksDue(withinDays);
    return jsonResponse(200, {
      withinDays,
      care_tasks: items.map(formatCareTask),
    });
  });

  // GET /stats/pnl?period=&storePricePerDozen=&milkPricePerGallon=&meatPricePerLb=
  // -- homestead profit & loss: costs (feed + health), outputs (egg/milk/meat
  // value + actual sales), and net.
  app.get("/stats/pnl", async ({ event }) => {
    const period = resolvePeriodString(event);
    const months = monthsForPeriod(period);
    if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    const options = {
      storePricePerDozen: parseStorePrice(event),
      milkPricePerGallon: parsePrice(event, "milkPricePerGallon"),
      meatPricePerLb: parsePrice(event, "meatPricePerLb"),
    };
    return jsonResponse(200, await pnlStats(period, months, options));
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

// Parses a named non-negative price query param, or undefined when absent so
// the domain layer falls back to its env default.
function parsePrice(event, name) {
  const raw = event?.queryStringParameters?.[name];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestError(`${name} must be a non-negative number`);
  }
  return parsed;
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
