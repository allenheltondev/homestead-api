import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, ddb } from "../services/ddb.mjs";
import { yyyymm } from "../services/time.mjs";

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

// --- Summary ------------------------------------------------------------
// One speakable payload composing the above: herd by species, births &
// deaths this month + this year, feed spend this month, and pasture
// occupancy. Shaped flat / labeled for Alexa speech.
export async function summaryStats(now = new Date()) {
  const month = yyyymm(now);
  const year = String(new Date(now).getUTCFullYear());
  const yearMonths = monthsForPeriod(year);

  const [herd, occupancy, birthsMonth, birthsYear, deathsMonth, deathsYear, feedMonth] =
    await Promise.all([
      herdStats(),
      pastureOccupancy(),
      birthStats([month]),
      birthStats(yearMonths),
      deathStats([month]),
      deathStats(yearMonths),
      feedStats([month]),
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
    },
    pastures: {
      total: occupancy.total,
      occupancy: occupancy.pastures.map((p) => ({ name: p.name, count: p.count })),
    },
  };
}
