import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, ddb } from "../services/ddb.mjs";
import { yyyymm } from "../services/time.mjs";
import { isPoultryType } from "../validation/feed.mjs";
import { listGrowerCrops, listCropHarvests } from "../lib/grn.mjs";
import { GrnNotConfiguredError, GrnUnauthorizedError } from "../services/errors.mjs";

// Default store price per dozen when neither the query param nor the
// STORE_EGG_PRICE_PER_DOZEN env var supplies one.
const DEFAULT_STORE_PRICE_PER_DOZEN = 4.0;

// Resolves the store price per dozen: explicit override wins, else the
// STORE_EGG_PRICE_PER_DOZEN env var (parsed as a float), else 4.0.
export function resolveStorePricePerDozen(override) {
  if (override !== undefined && override !== null) {
    return override;
  }
  const fromEnv = parseFloat(process.env.STORE_EGG_PRICE_PER_DOZEN);
  return Number.isFinite(fromEnv) ? fromEnv : DEFAULT_STORE_PRICE_PER_DOZEN;
}

// Read-only aggregation for the stats & reporting endpoints. Every read
// here is a Query against a known partition (base table, GSI1, or GSI2) --
// there are NEVER any Scans. We pull the matching items and aggregate the
// counts/sums in memory. The key schema mirrors docs/DATA_MODEL.md exactly
// so these reports work once the animals / pasture / feed write streams
// merge.

// Drains a paginated Query into a single array of items. Personal-scale
// data, so fully consuming the pages per request is fine.
async function queryAll(params) {
  const items = [];
  let exclusiveStartKey;
  do {
    const result = await ddb.send(
      new QueryCommand({ ...params, ExclusiveStartKey: exclusiveStartKey }),
    );
    for (const item of result.Items ?? []) items.push(item);
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

// Drains a paginated COUNT Query, summing the per-page Count. Returns the
// total item count without ever materializing the items.
async function queryCount(params) {
  let count = 0;
  let exclusiveStartKey;
  do {
    const result = await ddb.send(
      new QueryCommand({
        ...params,
        Select: "COUNT",
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    count += result.Count ?? 0;
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return count;
}

// Expands a period string into the list of month buckets it covers.
//   "2026-06" -> ["2026-06"]
//   "2026"    -> ["2026-01" ... "2026-12"]
// Returns null for an unparseable value so callers can 400.
export function monthsForPeriod(period) {
  if (typeof period !== "string") return null;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return [period];
  if (/^\d{4}$/.test(period)) {
    return Array.from({ length: 12 }, (_, i) => `${period}-${String(i + 1).padStart(2, "0")}`);
  }
  return null;
}

// --- Herd ---------------------------------------------------------------
// ONE Query on GSI2 (gsi2pk = ANIMAL) returns every animal item across the
// single collection partition; counts by species and status are tallied in
// code.
// TODO: at scale, maintain rollup counters via the DDB stream instead of
// reading the whole collection partition on every call.
export async function herdStats() {
  const animals = await queryAll({
    TableName: TABLE_NAME,
    IndexName: "GSI2",
    KeyConditionExpression: "gsi2pk = :pk",
    ExpressionAttributeValues: { ":pk": "ANIMAL" },
  });

  const bySpecies = {};
  const byStatus = { active: 0, deceased: 0, sold: 0 };
  let total = 0;

  for (const a of animals) {
    total += 1;
    const species = a.species ?? "unknown";
    const status = a.status ?? "unknown";

    if (!bySpecies[species]) {
      bySpecies[species] = { total: 0, active: 0, deceased: 0, sold: 0 };
    }
    bySpecies[species].total += 1;
    if (status in bySpecies[species]) bySpecies[species][status] += 1;
    if (status in byStatus) byStatus[status] += 1;
  }

  return { total, bySpecies, byStatus };
}

// --- Pasture occupancy --------------------------------------------------
// List pastures from GSI1 (gsi1pk = PASTURE), then for each pasture run a
// COUNT Query on GSI1 (gsi1pk = PASTURE#<id>, begins_with animal pointer)
// so we never load the animal items just to count them.
export async function pastureOccupancy() {
  const pastures = await queryAll({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": "PASTURE" },
  });

  const occupancy = await Promise.all(
    pastures.map(async (p) => {
      const id = pastureId(p);
      const count = await queryCount({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `PASTURE#${id}`,
          ":sk": "ANIMAL#",
        },
      });
      return { pastureId: id, name: p.name ?? p.gsi1sk ?? null, count };
    }),
  );

  const total = occupancy.reduce((sum, o) => sum + o.count, 0);
  return { total, pastures: occupancy };
}

// The pasture's id lives on its base pk (PASTURE#<id>); fall back to an
// explicit id attribute if present.
function pastureId(item) {
  if (item.id) return item.id;
  if (typeof item.pk === "string" && item.pk.startsWith("PASTURE#")) {
    return item.pk.slice("PASTURE#".length);
  }
  return item.pk ?? null;
}

// --- Lifecycle events by period ----------------------------------------
// Births / deaths are queried from GSI1 (gsi1pk = EVENT#<TYPE>#<yyyy-mm>).
// A YYYY period fans across its 12 months and sums.
async function lifecycleCount(type, months) {
  const counts = await Promise.all(
    months.map((month) =>
      queryCount({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": `EVENT#${type}#${month}` },
      }),
    ),
  );
  return counts.reduce((sum, c) => sum + c, 0);
}

export async function birthStats(months) {
  const total = await lifecycleCount("BIRTH", months);
  return { type: "birth", months, total };
}

export async function deathStats(months) {
  const total = await lifecycleCount("DEATH", months);
  return { type: "death", months, total };
}

// --- Mortality / health analytics --------------------------------------
// Queries the EVENT#DEATH#<yyyy-mm> reporting partitions (pattern 8) for the
// period and tallies deaths by cause from the death event payload. Unlike
// deathStats (a COUNT Query), this pulls the items so it can read each
// event's `cause` attribute. lossRate approximates deaths over the average
// active herd size, using the current active count as the denominator (a
// personal-scale approximation -- no historical herd snapshots are kept).
// No Scans: deaths come from GSI1 partitions, the active count from the GSI2
// animal collection.
export async function mortalityStats(period, months) {
  const [deathEvents, herd] = await Promise.all([
    deathEventsForMonths(months),
    herdStats(),
  ]);

  const byCauseMap = {};
  let totalDeaths = 0;
  for (const event of deathEvents) {
    totalDeaths += 1;
    const cause = typeof event.cause === "string" && event.cause.length > 0
      ? event.cause
      : "unknown";
    byCauseMap[cause] = (byCauseMap[cause] ?? 0) + 1;
  }

  const byCause = Object.entries(byCauseMap)
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause));

  // Average active herd size approximated by the current active count. Deaths
  // are added back so the denominator reflects animals that were alive during
  // the period rather than only the survivors, avoiding a divide-by-zero when
  // every active animal died.
  const activeNow = herd.byStatus.active;
  const denominator = activeNow + totalDeaths;
  const lossRate = denominator > 0 ? totalDeaths / denominator : 0;

  return { period, totalDeaths, byCause, lossRate };
}

// Queries every EVENT#DEATH#<yyyy-mm> partition in the months list (pattern
// 8) and returns the flat list of death event items (so callers can read
// `cause`). No Scan.
async function deathEventsForMonths(months) {
  const batches = await Promise.all(
    months.map((month) =>
      queryAll({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": `EVENT#DEATH#${month}` },
      }),
    ),
  );
  return batches.flat();
}

// Mortality block shaped for composition (digest/summary): the headline loss
// rate plus the single top cause (null when there were no deaths).
export async function mortalitySummary(period, months) {
  const { totalDeaths, byCause, lossRate } = await mortalityStats(period, months);
  return {
    totalDeaths,
    lossRate,
    topCause: byCause.length > 0 ? byCause[0].cause : null,
  };
}

// --- Health expense analytics ------------------------------------------
// Aggregates HEALTHEXP#<yyyy-mm> expense rows (pattern 18) for the period:
// total spend, spend grouped by category, and a per-animal figure (total
// spend over the current active animal count). Queries the month partitions
// for the period and the GSI2 animal collection -- no Scans.
export async function healthStats(period, months) {
  const [expenses, herd] = await Promise.all([
    healthExpensesForMonths(months),
    herdStats(),
  ]);

  const byCategoryMap = {};
  let totalSpend = 0;
  for (const expense of expenses) {
    const category = typeof expense.category === "string" && expense.category.length > 0
      ? expense.category
      : "unknown";
    const cost = Number(expense.cost) || 0;
    byCategoryMap[category] = (byCategoryMap[category] ?? 0) + cost;
    totalSpend += cost;
  }

  const byCategory = Object.entries(byCategoryMap)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));

  const activeAnimals = herd.byStatus.active;
  const perAnimal = activeAnimals > 0 ? totalSpend / activeAnimals : null;

  return { period, totalSpend, byCategory, perAnimal };
}

// Queries every HEALTHEXP#<yyyy-mm> partition in the months list (pattern 18)
// and returns the flat list of expense rows. No Scan.
async function healthExpensesForMonths(months) {
  const batches = await Promise.all(
    months.map((month) =>
      queryAll({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `HEALTHEXP#${month}`,
          ":sk": "EXP#",
        },
      }),
    ),
  );
  return batches.flat();
}

// --- Feed by period -----------------------------------------------------
// Feed purchases partition by month on the base table (pk = FEED#<yyyy-mm>).
// We Query each month in the period and sum cost + quantity grouped by
// feed type.
export async function feedStats(months) {
  const batches = await Promise.all(
    months.map((month) =>
      queryAll({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `FEED#${month}`,
          ":sk": "PURCHASE#",
        },
      }),
    ),
  );

  const byType = {};
  let totalCost = 0;
  let totalQuantity = 0;
  let purchaseCount = 0;

  for (const purchase of batches.flat()) {
    const type = purchase.type ?? "unknown";
    const cost = Number(purchase.cost) || 0;
    const quantity = Number(purchase.quantity) || 0;

    if (!byType[type]) byType[type] = { cost: 0, quantity: 0, purchases: 0 };
    byType[type].cost += cost;
    byType[type].quantity += quantity;
    byType[type].purchases += 1;

    totalCost += cost;
    totalQuantity += quantity;
    purchaseCount += 1;
  }

  return { months, totalCost, totalQuantity, purchaseCount, byType };
}

// --- Eggs by period -----------------------------------------------------
// Egg collections partition by month on the base table (pk = EGG#<yyyy-mm>).
// We Query each month in the period and sum the counts. `days` is the count
// of distinct collection days; `perDay` is the average eggs per collection
// day (0 when there were none). No Scans.
export async function eggStats(months, { flock, birdType } = {}) {
  const batches = await Promise.all(
    months.map((month) =>
      queryAll({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `EGG#${month}`,
          ":sk": "COLLECT#",
        },
      }),
    ),
  );

  let totalEggs = 0;
  const collectionDays = new Set();
  // Per-bird-type breakdown (eggs + dozens). Legacy rows (no birdType) count
  // as chicken so the breakdown is always complete.
  const byBirdTypeMap = {};

  for (const collection of batches.flat()) {
    // Per-flock attribution restricts the tally to one coop (the flock key);
    // the default (no flock) counts every collection, unchanged.
    if (flock !== undefined && collection.coop !== flock) continue;
    const rowBirdType = collection.birdType ?? "chicken";
    // Optional bird-type filter restricts the tally; the default counts all.
    if (birdType !== undefined && rowBirdType !== birdType) continue;
    const count = Number(collection.count) || 0;
    totalEggs += count;
    byBirdTypeMap[rowBirdType] = (byBirdTypeMap[rowBirdType] ?? 0) + count;
    const collectedAt = collection.collectedAt;
    if (typeof collectedAt === "string") {
      collectionDays.add(collectedAt.slice(0, 10));
    }
  }

  const days = collectionDays.size;
  const dozens = totalEggs / 12;
  const perDay = days > 0 ? totalEggs / days : 0;

  const byBirdType = Object.entries(byBirdTypeMap)
    .map(([type, eggs]) => ({ birdType: type, eggs, dozens: eggs / 12 }))
    .sort((a, b) => a.birdType.localeCompare(b.birdType));

  return { totalEggs, dozens, days, perDay, byBirdType };
}

// Builds the GET /stats/eggs payload for a period. An optional birdType filter
// restricts the totals to one bird type; the byBirdType breakdown is always
// included. With no birdType the top-level figures are unchanged.
export async function eggStatsForPeriod(period, months, { birdType } = {}) {
  const { totalEggs, dozens, days, perDay, byBirdType } = await eggStats(months, { birdType });
  const out = { period, totalEggs, dozens, days, perDay, byBirdType };
  if (birdType !== undefined) out.birdType = birdType;
  return out;
}

// --- Egg cost per dozen -------------------------------------------------
// Two cost-per-dozen models, both poultry-only:
//
//  1. PURCHASE BASIS (original, unchanged top-level fields): divides poultry
//     feed *spend* (sum of purchase `cost`) over the period by dozens. Simple
//     and cash-flow oriented, but lumpy -- a bulk buy in one month inflates
//     that month's cost-per-dozen even though the feed feeds many months.
//
//  2. CONSUMPTION BASIS (added `consumptionBasis` block): divides the value
//     of poultry feed *consumed* during the period -- consumed lbs valued at
//     the average purchase unit cost ($/lb) -- by dozens, counting only the
//     dozens collected in *lay months* (months in the period that actually
//     have egg collections). This matches feed actually eaten to eggs
//     actually produced, so it doesn't swing with purchase timing and ignores
//     out-of-lay months that have feed usage but no eggs.
//
// Both leave cost figures null when there are no qualifying dozens so callers
// never divide by zero. The store comparison uses the resolved store price.
export async function eggCostStats(period, months, { storePricePerDozen, flock, birdType } = {}) {
  const [{ totalEggs, dozens }, poultryFeedSpend, consumptionBasis] = await Promise.all([
    eggStats(months, { flock, birdType }),
    poultryFeedSpendForMonths(months, { flock }),
    poultryConsumptionBasis(months, storePricePerDozen, { flock }),
  ]);

  const storePrice = resolveStorePricePerDozen(storePricePerDozen);

  let costPerDozen = null;
  let costPerEgg = null;
  let savingsPerDozen = null;
  let cheaperThanStore = null;

  if (dozens > 0) {
    costPerDozen = poultryFeedSpend / dozens;
    savingsPerDozen = storePrice - costPerDozen;
    cheaperThanStore = costPerDozen < storePrice;
  }
  if (totalEggs > 0) {
    costPerEgg = poultryFeedSpend / totalEggs;
  }

  const out = {
    period,
    eggs: totalEggs,
    dozens,
    poultryFeedSpend,
    costPerDozen,
    costPerEgg,
    storePricePerDozen: storePrice,
    savingsPerDozen,
    cheaperThanStore,
    consumptionBasis,
  };
  // Only surface the flock dimension when one was requested so the default
  // payload shape is byte-for-byte unchanged.
  if (flock !== undefined) out.flock = flock;
  // Likewise surface birdType only when filtering by it.
  if (birdType !== undefined) out.birdType = birdType;
  return out;
}

// Per-flock egg cost rollup. Discovers the set of flocks (coop values) seen
// in the period's egg collections, then computes a cost-per-dozen row for
// each by restricting eggs to that coop and poultry feed to that flock.
// Returns one row per flock, sorted by flock key. No Scans (egg + feed month
// partitions only).
export async function eggCostByFlock(period, months, { storePricePerDozen } = {}) {
  const flocks = await flocksForMonths(months);
  const rows = await Promise.all(
    flocks.map(async (flock) => {
      const stats = await eggCostStats(period, months, { storePricePerDozen, flock });
      return {
        flock,
        dozens: stats.dozens,
        poultryFeedSpend: stats.poultryFeedSpend,
        costPerDozen: stats.costPerDozen,
        consumptionBasis: stats.consumptionBasis,
      };
    }),
  );
  return rows.sort((a, b) => a.flock.localeCompare(b.flock));
}

// The distinct, non-empty coop values across the period's egg collections.
// Drives the by-flock grouping. Queries the egg month partitions (pattern
// 14) -- no Scan.
async function flocksForMonths(months) {
  const batches = await Promise.all(
    months.map((month) =>
      queryAll({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `EGG#${month}`,
          ":sk": "COLLECT#",
        },
      }),
    ),
  );

  const flocks = new Set();
  for (const collection of batches.flat()) {
    if (typeof collection.coop === "string" && collection.coop.length > 0) {
      flocks.add(collection.coop);
    }
  }
  return [...flocks];
}

// Builds the consumption-basis cost-per-dozen block (see eggCostStats).
//
// - avgUnitCost: total poultry purchase cost / total poultry purchased lbs
//   ($/lb) over the period. null when no poultry weight was purchased.
// - consumedLbs: poultry feed consumed during the period.
// - consumedValue: consumedLbs * avgUnitCost (null when avgUnitCost is null).
// - layMonths: months in the period that have at least one egg collection.
// - dozens: dozens collected in those lay months only.
// - costPerDozen: consumedValue / dozens; null when either input is null/0.
async function poultryConsumptionBasis(months, storePricePerDozen, { flock } = {}) {
  const [purchases, consumption, perMonthEggs] = await Promise.all([
    feedPurchasesForMonths(months),
    feedConsumptionForMonths(months),
    Promise.all(months.map((m) => eggStats([m], { flock }))),
  ]);

  // Average poultry purchase unit cost ($/lb) over the period. When a flock
  // is requested, only purchases tagged with that flock count.
  let purchasedLbs = 0;
  let purchaseCost = 0;
  for (const purchase of purchases) {
    if (purchaseFeedType(purchase) === "poultry" && matchesFlock(purchase, flock)) {
      purchasedLbs += purchaseLbs(purchase);
      purchaseCost += Number(purchase.cost) || 0;
    }
  }
  const avgUnitCost = purchasedLbs > 0 ? purchaseCost / purchasedLbs : null;

  // Poultry feed consumed during the period (flock-restricted when asked).
  let consumedLbs = 0;
  for (const usage of consumption) {
    if (usageFeedType(usage) === "poultry" && matchesFlock(usage, flock)) {
      consumedLbs += Number(usage.lbs) || 0;
    }
  }

  // Lay months + the dozens collected in them.
  let layMonths = 0;
  let dozens = 0;
  for (let i = 0; i < months.length; i += 1) {
    if (perMonthEggs[i].totalEggs > 0) {
      layMonths += 1;
      dozens += perMonthEggs[i].dozens;
    }
  }

  const consumedValue = avgUnitCost === null ? null : consumedLbs * avgUnitCost;

  let costPerDozen = null;
  let savingsPerDozen = null;
  let cheaperThanStore = null;
  if (consumedValue !== null && dozens > 0) {
    const storePrice = resolveStorePricePerDozen(storePricePerDozen);
    costPerDozen = consumedValue / dozens;
    savingsPerDozen = storePrice - costPerDozen;
    cheaperThanStore = costPerDozen < storePrice;
  }

  return {
    avgUnitCost,
    consumedLbs,
    consumedValue,
    layMonths,
    dozens,
    costPerDozen,
    savingsPerDozen,
    cheaperThanStore,
  };
}

// Sums `cost` over feed purchases in the given months whose feedType is
// poultry. Queries each month's FEED#<yyyy-mm> partition (no Scan) and
// classifies by feedType/type using the shared poultry rule.
async function poultryFeedSpendForMonths(months, { flock } = {}) {
  const batches = await Promise.all(
    months.map((month) =>
      queryAll({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `FEED#${month}`,
          ":sk": "PURCHASE#",
        },
      }),
    ),
  );

  let spend = 0;
  for (const purchase of batches.flat()) {
    if (isPoultryType(purchase.feedType ?? purchase.type) && matchesFlock(purchase, flock)) {
      spend += Number(purchase.cost) || 0;
    }
  }
  return spend;
}

// Whether a feed row belongs to the requested flock. With no flock filter
// (the default), everything matches so legacy behavior is preserved. When a
// flock is requested, only rows tagged with that exact `flock` value match;
// untagged legacy rows do not contribute to a flock-scoped figure.
function matchesFlock(row, flock) {
  if (flock === undefined) return true;
  return row.flock === flock;
}

// --- Feed inventory + forecasting --------------------------------------
// Composes feed purchases (lbs in) with feed consumption (lbs out) to a
// per-feedType on-hand position, value, and a 30-day burn-rate forecast.
// All reads Query a known month partition (FEED#<yyyy-mm> for purchases,
// FEEDUSE#<yyyy-mm> for consumption) -- there are NO Scans.
//
// Field model (per feedType, plus a `totals` object):
//   purchasedLbs  total weight purchased. Prefer `totalLbs`; else
//                 bags * bagWeightLbs; else the legacy `quantity` (treated
//                 as lb -- legacy purchases recorded quantity in pounds).
//   consumedLbs   total weight consumed (sum of usage `lbs`).
//   onHandLbs     purchasedLbs - consumedLbs (floored at 0 so a data gap
//                 can't report a negative inventory).
//   avgUnitCost   total purchase cost / purchasedLbs ($/lb); null when no
//                 weight was purchased.
//   onHandValue   onHandLbs * avgUnitCost (null when avgUnitCost is null).
//   burnRateLbsPerDay  consumed lbs over a trailing 30-day window / 30.
//   daysRemaining onHandLbs / burnRate; null when burnRate is 0.
//   projectedRunOutDate  today + daysRemaining (ISO date); null when
//                 daysRemaining is null.

// The grain weight of a single purchase row. Prefers the explicit totalLbs,
// then derives from bags * bagWeightLbs, then falls back to the legacy
// quantity attribute (legacy purchases recorded quantity in pounds). Returns
// 0 when no weight can be determined so a malformed row contributes nothing.
function purchaseLbs(purchase) {
  const totalLbs = Number(purchase.totalLbs);
  if (Number.isFinite(totalLbs) && totalLbs > 0) return totalLbs;

  const bags = Number(purchase.bags);
  const bagWeightLbs = Number(purchase.bagWeightLbs);
  if (Number.isFinite(bags) && Number.isFinite(bagWeightLbs) && bags > 0 && bagWeightLbs > 0) {
    return bags * bagWeightLbs;
  }

  const quantity = Number(purchase.quantity);
  if (Number.isFinite(quantity) && quantity > 0) return quantity;

  return 0;
}

// The feedType key a purchase aggregates under. Mirrors the egg-cost
// classification: poultry aliases collapse to "poultry"; otherwise the stored
// feedType/type is used verbatim (already normalized lower-case on write).
function purchaseFeedType(purchase) {
  const raw = purchase.feedType ?? purchase.type;
  if (isPoultryType(raw)) return "poultry";
  return typeof raw === "string" && raw.length > 0 ? raw : "unknown";
}

// Queries every FEED#<yyyy-mm> purchase partition in the months list (no
// Scan) and returns the flat list of purchase rows.
async function feedPurchasesForMonths(months) {
  const batches = await Promise.all(
    months.map((month) =>
      queryAll({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `FEED#${month}`,
          ":sk": "PURCHASE#",
        },
      }),
    ),
  );
  return batches.flat();
}

// Queries every FEEDUSE#<yyyy-mm> consumption partition in the months list
// (no Scan) and returns the flat list of usage rows.
async function feedConsumptionForMonths(months) {
  const batches = await Promise.all(
    months.map((month) =>
      queryAll({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `FEEDUSE#${month}`,
          ":sk": "USE#",
        },
      }),
    ),
  );
  return batches.flat();
}

// The usage row's feedType, collapsing poultry aliases like purchases do.
function usageFeedType(usage) {
  const raw = usage.feedType;
  if (isPoultryType(raw)) return "poultry";
  return typeof raw === "string" && raw.length > 0 ? raw : "unknown";
}

// Expands the list of YYYY-MM buckets covering [startMs, endMs] inclusive so
// the trailing-window burn rate queries only the partitions it needs.
function monthsBetween(startMs, endMs) {
  const start = new Date(startMs);
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  const end = new Date(endMs);
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();

  const months = [];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month + 1).padStart(2, "0")}`);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return months;
}

// Lifetime feed inventory: aggregates every purchase and consumption record
// to date into a per-feedType on-hand position + 30-day burn forecast.
//
// `months` bounds the purchase + consumption aggregation (purchasedLbs,
// consumedLbs, value). It defaults to every month from the earliest tracked
// month through the current month so the on-hand figure reflects lifetime
// flow; callers can pass an explicit list to scope it.
//
// The burn rate always uses a trailing 30-day window ending at `now`
// regardless of `months`, so daysRemaining reflects recent usage.
export async function feedInventory(now = new Date(), { months } = {}) {
  const nowDate = new Date(now);
  // Default the aggregation window to a wide lifetime range. Tracking begins
  // well after 2000, so this bounds the fan-out without missing data.
  const aggMonths = months ?? monthsBetween(
    Date.UTC(2000, 0, 1),
    Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1),
  );

  // Trailing 30-day burn window.
  const windowMs = 30 * 24 * 60 * 60 * 1000;
  const windowStart = new Date(nowDate.getTime() - windowMs);
  const windowMonths = monthsBetween(windowStart.getTime(), nowDate.getTime());
  const windowStartIso = windowStart.toISOString();
  const windowEndIso = nowDate.toISOString();

  const [purchases, consumption, windowConsumption] = await Promise.all([
    feedPurchasesForMonths(aggMonths),
    feedConsumptionForMonths(aggMonths),
    feedConsumptionForMonths(windowMonths),
  ]);

  // Per-feedType accumulators: purchased lbs/cost (for value + avgUnitCost),
  // consumed lbs, and trailing-window consumed lbs (for burn rate).
  const byType = {};
  const ensure = (type) => {
    if (!byType[type]) {
      byType[type] = { purchasedLbs: 0, purchaseCost: 0, consumedLbs: 0, windowLbs: 0 };
    }
    return byType[type];
  };

  for (const purchase of purchases) {
    const acc = ensure(purchaseFeedType(purchase));
    acc.purchasedLbs += purchaseLbs(purchase);
    acc.purchaseCost += Number(purchase.cost) || 0;
  }

  for (const usage of consumption) {
    ensure(usageFeedType(usage)).consumedLbs += Number(usage.lbs) || 0;
  }

  for (const usage of windowConsumption) {
    const usedAt = usage.usedAt;
    if (typeof usedAt === "string" && usedAt >= windowStartIso && usedAt <= windowEndIso) {
      ensure(usageFeedType(usage)).windowLbs += Number(usage.lbs) || 0;
    }
  }

  const feedTypes = Object.entries(byType)
    .map(([feedType, acc]) => buildInventoryEntry(feedType, acc, nowDate))
    .sort((a, b) => a.feedType.localeCompare(b.feedType));

  return { feedTypes, totals: buildInventoryTotals(feedTypes) };
}

// Shapes one feedType's accumulator into the public inventory entry, deriving
// on-hand, value, burn rate, and the run-out forecast.
function buildInventoryEntry(feedType, acc, nowDate) {
  const purchasedLbs = acc.purchasedLbs;
  const consumedLbs = acc.consumedLbs;
  const onHandLbs = Math.max(0, purchasedLbs - consumedLbs);

  const avgUnitCost = purchasedLbs > 0 ? acc.purchaseCost / purchasedLbs : null;
  const onHandValue = avgUnitCost === null ? null : onHandLbs * avgUnitCost;

  const burnRateLbsPerDay = acc.windowLbs / 30;
  const { daysRemaining, projectedRunOutDate } = forecastRunOut(
    onHandLbs,
    burnRateLbsPerDay,
    nowDate,
  );

  return {
    feedType,
    purchasedLbs,
    consumedLbs,
    onHandLbs,
    avgUnitCost,
    onHandValue,
    burnRateLbsPerDay,
    daysRemaining,
    projectedRunOutDate,
  };
}

// daysRemaining = onHandLbs / burnRate (null when burnRate is 0 -- nothing
// is being consumed, so it never runs out on the current trend);
// projectedRunOutDate = today + daysRemaining as an ISO date.
function forecastRunOut(onHandLbs, burnRateLbsPerDay, nowDate) {
  if (!(burnRateLbsPerDay > 0)) {
    return { daysRemaining: null, projectedRunOutDate: null };
  }
  const daysRemaining = onHandLbs / burnRateLbsPerDay;
  const runOutMs = nowDate.getTime() + daysRemaining * 24 * 60 * 60 * 1000;
  const projectedRunOutDate = new Date(runOutMs).toISOString().slice(0, 10);
  return { daysRemaining, projectedRunOutDate };
}

// Rolls the per-feedType entries into a totals object. Weighted figures
// (purchasedLbs/consumedLbs/onHandLbs/value) sum directly; the aggregate
// burn rate sums the per-type rates and re-derives daysRemaining + run-out
// from the totals so the headline forecast is internally consistent.
function buildInventoryTotals(feedTypes) {
  const totals = {
    purchasedLbs: 0,
    consumedLbs: 0,
    onHandLbs: 0,
    onHandValue: 0,
    burnRateLbsPerDay: 0,
  };

  for (const e of feedTypes) {
    totals.purchasedLbs += e.purchasedLbs;
    totals.consumedLbs += e.consumedLbs;
    totals.onHandLbs += e.onHandLbs;
    totals.onHandValue += e.onHandValue ?? 0;
    totals.burnRateLbsPerDay += e.burnRateLbsPerDay;
  }

  const { daysRemaining, projectedRunOutDate } = forecastRunOut(
    totals.onHandLbs,
    totals.burnRateLbsPerDay,
    new Date(),
  );
  totals.daysRemaining = daysRemaining;
  totals.projectedRunOutDate = projectedRunOutDate;
  return totals;
}

// --- Summary ------------------------------------------------------------
// One speakable payload composing the above: herd by species, births &
// deaths this month + this year, feed spend this month, and pasture
// occupancy. Shaped flat / labeled for Alexa speech.
export async function summaryStats(now = new Date()) {
  const month = yyyymm(now);
  const year = String(new Date(now).getUTCFullYear());
  const yearMonths = monthsForPeriod(year);

  const [
    herd,
    occupancy,
    birthsMonth,
    birthsYear,
    deathsMonth,
    deathsYear,
    feedMonth,
    eggsMonth,
    eggsWeek,
    eggCostMonth,
    inventory,
  ] = await Promise.all([
    herdStats(),
    pastureOccupancy(),
    birthStats([month]),
    birthStats(yearMonths),
    deathStats([month]),
    deathStats(yearMonths),
    feedStats([month]),
    eggStats([month]),
    eggsThisWeek(now),
    eggCostStats(month, [month]),
    feedInventory(now),
  ]);

  const herdBySpecies = Object.entries(herd.bySpecies).map(([species, s]) => ({
    species,
    total: s.total,
    active: s.active,
  }));

  return {
    asOf: { month, year },
    herd: {
      totalAnimals: herd.total,
      activeAnimals: herd.byStatus.active,
      bySpecies: herdBySpecies,
    },
    births: { thisMonth: birthsMonth.total, thisYear: birthsYear.total },
    deaths: { thisMonth: deathsMonth.total, thisYear: deathsYear.total },
    feed: {
      thisMonthSpend: feedMonth.totalCost,
      thisMonthQuantity: feedMonth.totalQuantity,
      // Composed from the feed-inventory totals: lbs currently on hand and
      // the headline days-remaining forecast (null when nothing is burning).
      onHandLbs: inventory.totals.onHandLbs,
      daysRemaining: inventory.totals.daysRemaining,
    },
    eggs: {
      thisWeek: eggsWeek,
      thisMonth: eggsMonth.totalEggs,
    },
    eggCost: {
      costPerDozenThisMonth: eggCostMonth.costPerDozen,
      cheaperThanStore: eggCostMonth.cheaperThanStore,
    },
    pastures: {
      total: occupancy.total,
      occupancy: occupancy.pastures.map((p) => ({ name: p.name, count: p.count })),
    },
  };
}

// Sums eggs collected in the trailing 7 days ending at `now` (inclusive).
// Queries each month partition the window touches (one or two) and filters
// rows by collectedAt -- no Scan.
async function eggsThisWeek(now = new Date()) {
  const end = new Date(now);
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const startMonth = yyyymm(start);
  const endMonth = yyyymm(end);
  const months = startMonth === endMonth ? [startMonth] : [startMonth, endMonth];

  const startIso = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0, 0, 0),
  ).toISOString();
  const endIso = end.toISOString();

  const batches = await Promise.all(
    months.map((month) =>
      queryAll({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `EGG#${month}`,
          ":sk": "COLLECT#",
        },
      }),
    ),
  );

  let total = 0;
  for (const collection of batches.flat()) {
    const collectedAt = collection.collectedAt;
    if (typeof collectedAt === "string" && collectedAt >= startIso && collectedAt <= endIso) {
      total += Number(collection.count) || 0;
    }
  }
  return total;
}

// --- Output price resolvers (P&L + milk/meat valuations) ---------------
// Resolve the milk price per gallon: explicit override wins, else the
// MILK_PRICE_PER_GALLON env var, else 8.0 (a typical raw-goat-milk figure).
const DEFAULT_MILK_PRICE_PER_GALLON = 8.0;
export function resolveMilkPricePerGallon(override) {
  if (override !== undefined && override !== null) return override;
  const fromEnv = parseFloat(process.env.MILK_PRICE_PER_GALLON);
  return Number.isFinite(fromEnv) ? fromEnv : DEFAULT_MILK_PRICE_PER_GALLON;
}

// Resolve the meat price per pound: explicit override wins, else the
// MEAT_PRICE_PER_LB env var, else 6.0.
const DEFAULT_MEAT_PRICE_PER_LB = 6.0;
export function resolveMeatPricePerLb(override) {
  if (override !== undefined && override !== null) return override;
  const fromEnv = parseFloat(process.env.MEAT_PRICE_PER_LB);
  return Number.isFinite(fromEnv) ? fromEnv : DEFAULT_MEAT_PRICE_PER_LB;
}

// --- Milk by period -----------------------------------------------------
// Milk logs partition by month on the base table (pk = MILK#<yyyy-mm>). We
// Query each month in the period and sum volume normalized to gallons. No
// Scans.

// Conversion factors to gallons (US). Unknown units are treated as gallons.
const GALLONS_PER = {
  gallon: 1,
  quart: 0.25,
  liter: 0.264172,
  ml: 0.000264172,
};

function toGallons(volume, unit) {
  const factor = GALLONS_PER[unit] ?? 1;
  return (Number(volume) || 0) * factor;
}

// Queries every MILK#<yyyy-mm> partition in the months list (no Scan) and
// returns the flat list of log rows.
async function milkLogsForMonths(months) {
  const batches = await Promise.all(
    months.map((month) =>
      queryAll({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `MILK#${month}`,
          ":sk": "LOG#",
        },
      }),
    ),
  );
  return batches.flat();
}

// Total milk volume (normalized to gallons) for the period, plus per-animal
// and per-day breakdowns. perDay is the average gallons per logging day.
export async function milkStats(period, months) {
  const logs = await milkLogsForMonths(months);

  let totalGallons = 0;
  const perAnimalMap = {};
  const perDayMap = {};

  for (const log of logs) {
    const gallons = toGallons(log.volume, log.unit);
    totalGallons += gallons;

    const animalId = log.animalId ?? "unattributed";
    perAnimalMap[animalId] = (perAnimalMap[animalId] ?? 0) + gallons;

    if (typeof log.loggedAt === "string") {
      const day = log.loggedAt.slice(0, 10);
      perDayMap[day] = (perDayMap[day] ?? 0) + gallons;
    }
  }

  const perAnimal = Object.entries(perAnimalMap)
    .map(([animalId, gallons]) => ({ animalId, gallons }))
    .sort((a, b) => b.gallons - a.gallons || a.animalId.localeCompare(b.animalId));

  const perDay = Object.entries(perDayMap)
    .map(([date, gallons]) => ({ date, gallons }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const loggingDays = perDay.length;
  const avgGallonsPerDay = loggingDays > 0 ? totalGallons / loggingDays : 0;

  return {
    period,
    totalGallons,
    unit: "gallon",
    loggingDays,
    avgGallonsPerDay,
    perAnimal,
    perDay,
  };
}

// --- Milk cost per gallon ----------------------------------------------
// Mirrors eggCostStats: divides goat-type feed spend over the period by total
// gallons produced -> cost per gallon. Feed counts as goat-type when its
// feedType/type is one of the goat aliases. Cost figures are null when there
// are no gallons. No Scans.
const GOAT_FEED_TYPES = new Set(["goat", "dairy", "dairy goat", "doe", "ruminant"]);

function isGoatFeedType(value) {
  if (typeof value !== "string") return false;
  return GOAT_FEED_TYPES.has(value.trim().toLowerCase());
}

async function goatFeedSpendForMonths(months) {
  const purchases = await feedPurchasesForMonths(months);
  let spend = 0;
  for (const purchase of purchases) {
    if (isGoatFeedType(purchase.feedType ?? purchase.type)) {
      spend += Number(purchase.cost) || 0;
    }
  }
  return spend;
}

export async function milkCostStats(period, months, { milkPricePerGallon } = {}) {
  const [{ totalGallons }, goatFeedSpend] = await Promise.all([
    milkStats(period, months),
    goatFeedSpendForMonths(months),
  ]);

  const marketPrice = resolveMilkPricePerGallon(milkPricePerGallon);

  let costPerGallon = null;
  let savingsPerGallon = null;
  let cheaperThanStore = null;
  if (totalGallons > 0) {
    costPerGallon = goatFeedSpend / totalGallons;
    savingsPerGallon = marketPrice - costPerGallon;
    cheaperThanStore = costPerGallon < marketPrice;
  }

  return {
    period,
    gallons: totalGallons,
    goatFeedSpend,
    costPerGallon,
    marketPricePerGallon: marketPrice,
    savingsPerGallon,
    cheaperThanStore,
  };
}

// --- Incubation analytics ----------------------------------------------
// Lists every batch from the INCUBATION collection partition (GSI1) and tallies
// active batches plus an overall hatch rate (sum hatchedCount / sum eggs set
// among batches that have reported a hatch). No Scans.
export async function incubationStats() {
  const batches = await queryAll({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": "INCUBATION" },
  });

  let activeBatches = 0;
  let eggsSetWithOutcome = 0;
  let totalHatched = 0;
  const active = [];

  for (const b of batches) {
    if (b.status === "incubating") {
      activeBatches += 1;
      active.push({
        id: b.id,
        species: b.species,
        count: b.count,
        setAt: b.setAt,
        expectedHatchAt: b.expectedHatchAt,
      });
      continue;
    }
    // Completed batches (hatched/partial/failed) contribute to the hatch rate.
    if (b.hatchedCount !== undefined && b.hatchedCount !== null) {
      eggsSetWithOutcome += Number(b.count) || 0;
      totalHatched += Number(b.hatchedCount) || 0;
    }
  }

  const hatchRate = eggsSetWithOutcome > 0 ? totalHatched / eggsSetWithOutcome : null;

  return {
    activeBatches,
    active,
    eggsSetWithOutcome,
    totalHatched,
    hatchRate,
  };
}

// --- Grow-out analytics -------------------------------------------------
// Lists every batch from the GROWOUT collection partition (GSI1) and tallies
// active (raising) batches and processed yield lbs. Optionally divides the
// poultry feed spend over the period by yield lbs for a cost-to-raise figure.
// No Scans.
export async function growoutStats(months) {
  const [batches, poultryFeedSpend] = await Promise.all([
    queryAll({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "gsi1pk = :pk",
      ExpressionAttributeValues: { ":pk": "GROWOUT" },
    }),
    months ? poultryFeedSpendForMonths(months) : Promise.resolve(null),
  ]);

  let activeBatches = 0;
  let processedBatches = 0;
  let dressedWeightLbsTotal = 0;
  let processedCount = 0;
  const active = [];

  for (const b of batches) {
    if (b.status === "processed") {
      processedBatches += 1;
      dressedWeightLbsTotal += Number(b.dressedWeightLbsTotal) || 0;
      processedCount += Number(b.processedCount) || 0;
    } else {
      activeBatches += 1;
      active.push({
        id: b.id,
        species: b.species,
        count: b.count,
        purpose: b.purpose,
        startedAt: b.startedAt,
      });
    }
  }

  const out = {
    activeBatches,
    active,
    processedBatches,
    dressedWeightLbsTotal,
    processedCount,
  };

  // Optional feed cost-to-raise: poultry feed spend over the period divided by
  // dressed yield lbs. null when no period was supplied or there's no yield.
  if (poultryFeedSpend !== null) {
    out.feedSpend = poultryFeedSpend;
    out.costToRaisePerLb = dressedWeightLbsTotal > 0
      ? poultryFeedSpend / dressedWeightLbsTotal
      : null;
  }

  return out;
}

// --- Garden / harvest analytics ----------------------------------------
// Harvests now live in the Good Roots Network (GRN), recorded per crop. We list
// the user's crops (GET /crops), fetch each crop's harvest log
// (GET /crops/{id}/harvests), sum the `amount` (a string) by crop and overall,
// filtering by `harvestedOn` within the period. There is no local harvest store
// or planting/bed join. Everything is wrapped so GRN being unconfigured /
// unauthorized degrades to an empty garden (it never fails /stats/garden,
// /stats/summary, or /stats/pnl) -- see grnGarden() below.

// Whether an ISO YYYY-MM-DD `harvestedOn` falls within the period's months.
// `months` are YYYY-MM buckets; a harvest counts when its YYYY-MM prefix is in
// the set. A missing/invalid date is excluded so the totals stay honest.
function harvestedOnInPeriod(harvestedOn, monthSet) {
  if (typeof harvestedOn !== "string" || harvestedOn.length < 7) return false;
  return monthSet.has(harvestedOn.slice(0, 7));
}

// Reads the user's crops from GRN and fans out one harvest-log fetch per crop,
// returning a flat list of {crop, harvests} pairs. Throws the typed GRN errors
// (GrnNotConfigured / GrnUnauthorized) up to gardenStats, which degrades.
async function grnCropHarvests(correlationId) {
  const cropsResult = await listGrowerCrops({ correlationId });
  const crops = Array.isArray(cropsResult) ? cropsResult : (cropsResult?.items ?? []);
  if (!Array.isArray(crops) || crops.length === 0) return [];

  return Promise.all(
    crops.map(async (crop) => {
      const log = await listCropHarvests(crop.id, { correlationId });
      const harvests = Array.isArray(log?.harvests) ? log.harvests : [];
      return { crop, harvests };
    }),
  );
}

// An empty garden-stats payload. Returned (instead of failing) whenever GRN is
// unconfigured / unauthorized so the broader /stats endpoints keep working.
function emptyGarden(period) {
  return { period, totalLbs: 0, byCrop: [] };
}

// GET /stats/garden — harvest totals by crop for the period, sourced from GRN.
// Each crop's display name comes from the grower crop (nickname || crop_name),
// its GRN crop-library id is surfaced as `cropLibraryId`, and `lbs` is the sum
// of harvest `amount` for harvests whose `harvestedOn` falls in the period.
// (Amounts are unit-agnostic in GRN; the prior oz->lb normalization is gone.)
// Degrades to an empty garden when GRN is not configured / unauthorized.
export async function gardenStats(period, months, { correlationId } = {}) {
  const monthSet = new Set(months);

  let cropHarvests;
  try {
    cropHarvests = await grnCropHarvests(correlationId);
  } catch (err) {
    if (err instanceof GrnNotConfiguredError || err instanceof GrnUnauthorizedError) {
      return emptyGarden(period);
    }
    throw err;
  }

  const byCrop = [];
  let totalLbs = 0;

  for (const { crop, harvests } of cropHarvests) {
    let cropLbs = 0;
    for (const h of harvests) {
      if (!harvestedOnInPeriod(h?.harvestedOn, monthSet)) continue;
      cropLbs += Number(h?.amount) || 0;
    }
    if (cropLbs === 0) continue;

    const cropName = typeof crop?.nickname === "string" && crop.nickname.trim().length > 0
      ? crop.nickname.trim()
      : (typeof crop?.crop_name === "string" && crop.crop_name.length > 0 ? crop.crop_name : "unknown");

    byCrop.push({ cropName, cropLibraryId: crop?.id ?? null, lbs: cropLbs, count: 0 });
    totalLbs += cropLbs;
  }

  byCrop.sort((a, b) => b.lbs - a.lbs || a.cropName.localeCompare(b.cropName));

  return { period, totalLbs, byCrop };
}

// Resolve the produce price per pound: explicit override wins, else the
// PRODUCE_PRICE_PER_LB env var, else 0 (so the P&L produce tie-in defaults off
// and prior behavior is preserved when unset).
export function resolveProducePricePerLb(override) {
  if (override !== undefined && override !== null) return override;
  const fromEnv = parseFloat(process.env.PRODUCE_PRICE_PER_LB);
  return Number.isFinite(fromEnv) ? fromEnv : 0;
}

// --- P&L ----------------------------------------------------------------
// Composes costs (feed + health spend) and outputs (egg/milk/meat value +
// actual sales) into a homestead profit & loss for the period.
//   costs   = feed spend + health spend (reused from the existing aggregations)
//   outputs = eggsValue (dozens * store egg price)
//           + milkValue (gallons * milk price)
//           + meatValue (grow-out dressed lbs * meat price)
//           + salesRevenue (sum of actual sales in the period)
//   net     = outputs - costs
// All reads Query known month / collection partitions -- no Scans.
export async function pnlStats(period, months, options = {}) {
  const {
    storePricePerDozen,
    milkPricePerGallon,
    meatPricePerLb,
    producePricePerLb,
  } = options;

  const [feed, health, eggs, milk, growout, salesRevenue, garden] = await Promise.all([
    feedStats(months),
    healthStats(period, months),
    eggStats(months),
    milkStats(period, months),
    growoutStats(),
    salesRevenueForMonths(months),
    gardenStats(period, months),
  ]);

  const feedSpend = feed.totalCost;
  const healthSpend = health.totalSpend;
  const costs = feedSpend + healthSpend;

  const eggPrice = resolveStorePricePerDozen(storePricePerDozen);
  const milkPrice = resolveMilkPricePerGallon(milkPricePerGallon);
  const meatPrice = resolveMeatPricePerLb(meatPricePerLb);
  // Defaults to 0 when neither the param nor PRODUCE_PRICE_PER_LB is set, so
  // produceValue is 0 and prior P&L behavior is preserved out of the box.
  const producePrice = resolveProducePricePerLb(producePricePerLb);

  const eggsValue = eggs.dozens * eggPrice;
  const milkValue = milk.totalGallons * milkPrice;
  const meatValue = growout.dressedWeightLbsTotal * meatPrice;
  // Garden produce valued at GRN-sourced harvest amount x the produce price (0
  // by default). gardenStats degrades to totalLbs 0 when GRN is unconfigured /
  // unauthorized, so produceValue is 0 and the rest of the P&L is unaffected.
  const produceValue = garden.totalLbs * producePrice;

  const outputs = eggsValue + milkValue + meatValue + produceValue + salesRevenue;
  const net = outputs - costs;

  return {
    period,
    costs: {
      total: costs,
      feedSpend,
      healthSpend,
    },
    outputs: {
      total: outputs,
      eggsValue,
      milkValue,
      meatValue,
      produceValue,
      salesRevenue,
    },
    prices: {
      storeEggPricePerDozen: eggPrice,
      milkPricePerGallon: milkPrice,
      meatPricePerLb: meatPrice,
      producePricePerLb: producePrice,
    },
    net,
  };
}

// Sums actual sales `amount` over the SALE#<yyyy-mm> partitions in the months
// list (no Scan).
async function salesRevenueForMonths(months) {
  const batches = await Promise.all(
    months.map((month) =>
      queryAll({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `SALE#${month}`,
          ":sk": "SALE#",
        },
      }),
    ),
  );
  let revenue = 0;
  for (const sale of batches.flat()) {
    revenue += Number(sale.amount) || 0;
  }
  return revenue;
}
