import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";

// Mock the shared DynamoDB document client. `send` is a jest fn that the
// per-test router inspects to decide what Query result to return, so we
// exercise the real aggregation logic against fabricated DDB responses
// without any AWS call. QueryCommand just echoes its input so the router
// can read the key-condition values.
const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));
jest.unstable_mockModule("@aws-sdk/lib-dynamodb", () => ({
  QueryCommand: jest.fn((input) => ({ input })),
}));

const {
  herdStats,
  pastureOccupancy,
  birthStats,
  deathStats,
  feedStats,
  eggStats,
  eggStatsForPeriod,
  eggCostStats,
  resolveStorePricePerDozen,
  summaryStats,
  monthsForPeriod,
} = await import("../../api/domain/stats.mjs");

// Drives `send` from a routing function (cmd.input) -> { Items } / { Count }.
// Defaults to an empty result so unmatched partitions count as zero.
function route(fn) {
  send.mockImplementation(async (cmd) => fn(cmd.input) ?? {});
}

beforeEach(() => {
  send.mockReset();
});

describe("monthsForPeriod", () => {
  test("YYYY-MM yields a single month", () => {
    expect(monthsForPeriod("2026-06")).toEqual(["2026-06"]);
  });

  test("YYYY fans across all twelve months", () => {
    expect(monthsForPeriod("2026")).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
    ]);
  });

  test("rejects garbage and out-of-range months", () => {
    expect(monthsForPeriod("2026-13")).toBeNull();
    expect(monthsForPeriod("nope")).toBeNull();
    expect(monthsForPeriod(undefined)).toBeNull();
  });
});

describe("herdStats", () => {
  test("aggregates counts by species and status from the GSI2 collection partition", async () => {
    route((input) => {
      expect(input.IndexName).toBe("GSI2");
      expect(input.ExpressionAttributeValues[":pk"]).toBe("ANIMAL");
      return {
        Items: [
          { species: "cattle", status: "active" },
          { species: "cattle", status: "active" },
          { species: "cattle", status: "deceased" },
          { species: "goat", status: "active" },
          { species: "goat", status: "sold" },
        ],
      };
    });

    const result = await herdStats();

    expect(result.total).toBe(5);
    expect(result.byStatus).toEqual({ active: 3, deceased: 1, sold: 1 });
    expect(result.bySpecies.cattle).toEqual({ total: 3, active: 2, deceased: 1, sold: 0 });
    expect(result.bySpecies.goat).toEqual({ total: 2, active: 1, deceased: 0, sold: 1 });
  });

  test("paginates the collection partition via LastEvaluatedKey", async () => {
    send
      .mockResolvedValueOnce({ Items: [{ species: "sheep", status: "active" }], LastEvaluatedKey: { k: 1 } })
      .mockResolvedValueOnce({ Items: [{ species: "sheep", status: "active" }] });

    const result = await herdStats();

    expect(send).toHaveBeenCalledTimes(2);
    expect(result.total).toBe(2);
    expect(result.bySpecies.sheep.active).toBe(2);
  });
});

describe("pastureOccupancy", () => {
  test("lists pastures then COUNT-queries each pasture partition", async () => {
    route((input) => {
      // The PASTURE listing query.
      if (input.ExpressionAttributeValues[":pk"] === "PASTURE") {
        return {
          Items: [
            { pk: "PASTURE#north", name: "North Field" },
            { pk: "PASTURE#south", name: "South Field" },
          ],
        };
      }
      // Per-pasture COUNT query.
      expect(input.Select).toBe("COUNT");
      if (input.ExpressionAttributeValues[":pk"] === "PASTURE#north") return { Count: 3 };
      if (input.ExpressionAttributeValues[":pk"] === "PASTURE#south") return { Count: 1 };
      return { Count: 0 };
    });

    const result = await pastureOccupancy();

    expect(result.total).toBe(4);
    expect(result.pastures).toEqual(
      expect.arrayContaining([
        { pastureId: "north", name: "North Field", count: 3 },
        { pastureId: "south", name: "South Field", count: 1 },
      ]),
    );
  });
});

describe("birthStats / deathStats", () => {
  test("births in a single month query the EVENT#BIRTH#<month> partition", async () => {
    route((input) => {
      expect(input.IndexName).toBe("GSI1");
      expect(input.Select).toBe("COUNT");
      expect(input.ExpressionAttributeValues[":pk"]).toBe("EVENT#BIRTH#2026-06");
      return { Count: 4 };
    });

    const result = await birthStats(monthsForPeriod("2026-06"));
    expect(result).toEqual({ type: "birth", months: ["2026-06"], total: 4 });
  });

  test("deaths over a year sum the twelve monthly partitions", async () => {
    const counts = { "2026-01": 2, "2026-02": 1, "2026-12": 3 };
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      expect(pk.startsWith("EVENT#DEATH#")).toBe(true);
      const month = pk.slice("EVENT#DEATH#".length);
      return { Count: counts[month] ?? 0 };
    });

    const result = await deathStats(monthsForPeriod("2026"));
    expect(send).toHaveBeenCalledTimes(12);
    expect(result.total).toBe(6);
  });
});

describe("feedStats", () => {
  test("sums cost and quantity grouped by type across the period's months", async () => {
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      expect(input.ExpressionAttributeValues[":sk"]).toBe("PURCHASE#");
      if (pk === "FEED#2026-06") {
        return {
          Items: [
            { type: "hay", cost: 100, quantity: 5 },
            { type: "hay", cost: 50, quantity: 2 },
            { type: "grain", cost: 30, quantity: 1 },
          ],
        };
      }
      return { Items: [] };
    });

    const result = await feedStats(["2026-06"]);

    expect(result.totalCost).toBe(180);
    expect(result.totalQuantity).toBe(8);
    expect(result.purchaseCount).toBe(3);
    expect(result.byType.hay).toEqual({ cost: 150, quantity: 7, purchases: 2 });
    expect(result.byType.grain).toEqual({ cost: 30, quantity: 1, purchases: 1 });
  });

  test("a YYYY period queries each monthly feed partition", async () => {
    route((input) => {
      if (input.ExpressionAttributeValues[":pk"] === "FEED#2026-03") {
        return { Items: [{ type: "mineral", cost: 20, quantity: 1 }] };
      }
      return { Items: [] };
    });

    const result = await feedStats(monthsForPeriod("2026"));
    expect(send).toHaveBeenCalledTimes(12);
    expect(result.totalCost).toBe(20);
    expect(result.byType.mineral.quantity).toBe(1);
  });
});

describe("eggStats", () => {
  test("sums counts, counts distinct days, and averages per day", async () => {
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      expect(input.ExpressionAttributeValues[":sk"]).toBe("COLLECT#");
      if (pk === "EGG#2026-06") {
        return {
          Items: [
            { count: 12, collectedAt: "2026-06-01T00:00:00.000Z" },
            { count: 10, collectedAt: "2026-06-01T08:00:00.000Z" },
            { count: 14, collectedAt: "2026-06-02T00:00:00.000Z" },
          ],
        };
      }
      return { Items: [] };
    });

    const result = await eggStats(["2026-06"]);
    expect(result.totalEggs).toBe(36);
    expect(result.dozens).toBe(3);
    expect(result.days).toBe(2); // June 1 and June 2
    expect(result.perDay).toBe(18);
  });

  test("zero collections yields zeros (no divide-by-zero)", async () => {
    route(() => ({ Items: [] }));
    const result = await eggStatsForPeriod("2026-06", ["2026-06"]);
    expect(result).toEqual({
      period: "2026-06",
      totalEggs: 0,
      dozens: 0,
      days: 0,
      perDay: 0,
    });
  });
});

describe("resolveStorePricePerDozen", () => {
  afterEach(() => {
    delete process.env.STORE_EGG_PRICE_PER_DOZEN;
  });

  test("override wins", () => {
    process.env.STORE_EGG_PRICE_PER_DOZEN = "5";
    expect(resolveStorePricePerDozen(6)).toBe(6);
  });

  test("falls back to env then to 4.0", () => {
    process.env.STORE_EGG_PRICE_PER_DOZEN = "5.5";
    expect(resolveStorePricePerDozen()).toBe(5.5);
    delete process.env.STORE_EGG_PRICE_PER_DOZEN;
    expect(resolveStorePricePerDozen()).toBe(4.0);
  });
});

describe("eggCostStats", () => {
  afterEach(() => {
    delete process.env.STORE_EGG_PRICE_PER_DOZEN;
  });

  function routeEggsAndPoultry({ eggs, poultryCost }) {
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      if (pk === "EGG#2026-06") return { Items: eggs };
      if (pk === "FEED#2026-06") return { Items: poultryCost };
      return { Items: [] };
    });
  }

  test("computes cost per dozen / egg and store comparison on a poultry basis", async () => {
    routeEggsAndPoultry({
      eggs: [{ count: 24, collectedAt: "2026-06-01T00:00:00.000Z" }],
      poultryCost: [
        { feedType: "poultry", cost: 30 },
        { type: "layer", cost: 10 }, // legacy type alias still classified poultry
        { type: "hay", cost: 100 }, // not poultry -- excluded
      ],
    });

    const result = await eggCostStats("2026-06", ["2026-06"], { storePricePerDozen: 4 });
    expect(result.eggs).toBe(24);
    expect(result.dozens).toBe(2);
    expect(result.poultryFeedSpend).toBe(40);
    expect(result.costPerDozen).toBe(20);
    expect(result.costPerEgg).toBeCloseTo(40 / 24);
    expect(result.storePricePerDozen).toBe(4);
    expect(result.savingsPerDozen).toBe(4 - 20);
    expect(result.cheaperThanStore).toBe(false);
  });

  test("cheaperThanStore true when cost beats the store price", async () => {
    routeEggsAndPoultry({
      eggs: [{ count: 120, collectedAt: "2026-06-01T00:00:00.000Z" }],
      poultryCost: [{ feedType: "chicken", cost: 10 }],
    });
    const result = await eggCostStats("2026-06", ["2026-06"], { storePricePerDozen: 4 });
    expect(result.dozens).toBe(10);
    expect(result.costPerDozen).toBe(1);
    expect(result.cheaperThanStore).toBe(true);
  });

  test("null cost figures when there are no dozens", async () => {
    routeEggsAndPoultry({ eggs: [], poultryCost: [{ feedType: "poultry", cost: 50 }] });
    const result = await eggCostStats("2026-06", ["2026-06"], { storePricePerDozen: 4 });
    expect(result.dozens).toBe(0);
    expect(result.costPerDozen).toBeNull();
    expect(result.costPerEgg).toBeNull();
    expect(result.savingsPerDozen).toBeNull();
    expect(result.cheaperThanStore).toBeNull();
    expect(result.poultryFeedSpend).toBe(50);
  });

  test("defaults the store price from the env var", async () => {
    process.env.STORE_EGG_PRICE_PER_DOZEN = "6";
    routeEggsAndPoultry({
      eggs: [{ count: 12, collectedAt: "2026-06-01T00:00:00.000Z" }],
      poultryCost: [{ feedType: "poultry", cost: 3 }],
    });
    const result = await eggCostStats("2026-06", ["2026-06"]);
    expect(result.storePricePerDozen).toBe(6);
    expect(result.costPerDozen).toBe(3);
    expect(result.cheaperThanStore).toBe(true);
  });
});

describe("summaryStats", () => {
  test("composes herd, births/deaths this month + year, feed spend, and occupancy", async () => {
    const now = new Date("2026-06-21T00:00:00Z");

    route((input) => {
      const v = input.ExpressionAttributeValues;
      const pk = v[":pk"];

      // Herd (GSI2 = ANIMAL).
      if (input.IndexName === "GSI2" && pk === "ANIMAL") {
        return {
          Items: [
            { species: "cattle", status: "active" },
            { species: "cattle", status: "active" },
            { species: "goat", status: "deceased" },
          ],
        };
      }
      // Pasture listing.
      if (input.IndexName === "GSI1" && pk === "PASTURE") {
        return { Items: [{ pk: "PASTURE#north", name: "North Field" }] };
      }
      // Pasture occupancy COUNT.
      if (input.IndexName === "GSI1" && pk === "PASTURE#north") {
        return { Count: 2 };
      }
      // Births: this month vs each month of the year.
      if (pk === "EVENT#BIRTH#2026-06") return { Count: 3 };
      if (pk?.startsWith("EVENT#BIRTH#")) return { Count: 1 };
      // Deaths.
      if (pk === "EVENT#DEATH#2026-06") return { Count: 1 };
      if (pk?.startsWith("EVENT#DEATH#")) return { Count: 0 };
      // Feed this month: hay (non-poultry) + poultry for the egg-cost basis.
      if (pk === "FEED#2026-06") {
        return {
          Items: [
            { type: "hay", cost: 75, quantity: 4 },
            { feedType: "poultry", cost: 24, quantity: 2 },
          ],
        };
      }
      // Eggs this month: 24 eggs collected on June 21 (within the trailing week).
      if (pk === "EGG#2026-06") {
        return { Items: [{ count: 24, collectedAt: "2026-06-21T00:00:00.000Z" }] };
      }
      return {};
    });

    const summary = await summaryStats(now);

    expect(summary.asOf).toEqual({ month: "2026-06", year: "2026" });
    expect(summary.herd.totalAnimals).toBe(3);
    expect(summary.herd.activeAnimals).toBe(2);
    expect(summary.herd.bySpecies).toEqual(
      expect.arrayContaining([
        { species: "cattle", total: 2, active: 2 },
        { species: "goat", total: 1, active: 0 },
      ]),
    );
    // June counts 3; the full year = June (3) + 11 other months (1 each) = 14.
    expect(summary.births).toEqual({ thisMonth: 3, thisYear: 14 });
    expect(summary.deaths).toEqual({ thisMonth: 1, thisYear: 1 });
    expect(summary.feed).toEqual({ thisMonthSpend: 99, thisMonthQuantity: 6 });
    // 24 eggs this month, all within the trailing week (June 15-21).
    expect(summary.eggs).toEqual({ thisWeek: 24, thisMonth: 24 });
    // 24 eggs = 2 dozen; poultry feed spend 24 -> $12/dozen, above the $4 default.
    expect(summary.eggCost).toEqual({ costPerDozenThisMonth: 12, cheaperThanStore: false });
    expect(summary.pastures).toEqual({
      total: 2,
      occupancy: [{ name: "North Field", count: 2 }],
    });
  });
});
