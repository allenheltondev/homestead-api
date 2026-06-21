import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";

// Same mocking approach as tests/unit/stats.test.mjs: a jest `send` fn the
// per-test router inspects, and a QueryCommand that echoes its input. The new
// feed-inventory + consumption-basis aggregations only use QueryCommand, so
// this is sufficient -- no AWS call, no Scan.
const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));
jest.unstable_mockModule("@aws-sdk/lib-dynamodb", () => ({
  QueryCommand: jest.fn((input) => ({ input })),
}));

const {
  feedInventory,
  eggCostStats,
  summaryStats,
} = await import("../../api/domain/stats.mjs");

function route(fn) {
  send.mockImplementation(async (cmd) => fn(cmd.input) ?? {});
}

beforeEach(() => {
  send.mockReset();
});

describe("feedInventory", () => {
  test("composes purchases + consumption into on-hand, value, and burn forecast", async () => {
    const now = new Date("2026-06-21T00:00:00.000Z");

    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      // Poultry purchases: 200 lbs for $100 -> $0.50/lb.
      if (pk === "FEED#2026-06") {
        return {
          Items: [
            { feedType: "poultry", totalLbs: 200, cost: 100 },
            { type: "hay", quantity: 500, cost: 250 }, // legacy lbs, $0.50/lb
          ],
        };
      }
      // Consumption this month: 60 lbs poultry, 100 lbs hay -- all within the
      // trailing 30-day window (June 21 - 30 days).
      if (pk === "FEEDUSE#2026-06") {
        return {
          Items: [
            { feedType: "poultry", lbs: 60, usedAt: "2026-06-10T00:00:00.000Z" },
            { feedType: "hay", lbs: 100, usedAt: "2026-06-12T00:00:00.000Z" },
          ],
        };
      }
      return { Items: [] };
    });

    const result = await feedInventory(now);

    const poultry = result.feedTypes.find((f) => f.feedType === "poultry");
    expect(poultry.purchasedLbs).toBe(200);
    expect(poultry.consumedLbs).toBe(60);
    expect(poultry.onHandLbs).toBe(140);
    expect(poultry.avgUnitCost).toBe(0.5);
    expect(poultry.onHandValue).toBe(70); // 140 * 0.5
    // 60 lbs over a 30-day window -> 2 lbs/day; 140 / 2 = 70 days.
    expect(poultry.burnRateLbsPerDay).toBe(2);
    expect(poultry.daysRemaining).toBe(70);
    expect(poultry.projectedRunOutDate).toBe("2026-08-30");

    const hay = result.feedTypes.find((f) => f.feedType === "hay");
    expect(hay.purchasedLbs).toBe(500);
    expect(hay.consumedLbs).toBe(100);
    expect(hay.onHandLbs).toBe(400);

    expect(result.totals.purchasedLbs).toBe(700);
    expect(result.totals.consumedLbs).toBe(160);
    expect(result.totals.onHandLbs).toBe(540);
  });

  test("burnRate 0 yields null daysRemaining and run-out date", async () => {
    const now = new Date("2026-06-21T00:00:00.000Z");
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      if (pk === "FEED#2026-06") {
        return { Items: [{ feedType: "poultry", totalLbs: 100, cost: 50 }] };
      }
      return { Items: [] }; // no consumption
    });

    const result = await feedInventory(now);
    const poultry = result.feedTypes.find((f) => f.feedType === "poultry");
    expect(poultry.onHandLbs).toBe(100);
    expect(poultry.burnRateLbsPerDay).toBe(0);
    expect(poultry.daysRemaining).toBeNull();
    expect(poultry.projectedRunOutDate).toBeNull();
    expect(result.totals.daysRemaining).toBeNull();
  });

  test("derives purchasedLbs from bags * bagWeightLbs when totalLbs is absent", async () => {
    const now = new Date("2026-06-21T00:00:00.000Z");
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      if (pk === "FEED#2026-06") {
        return { Items: [{ feedType: "poultry", bags: 4, bagWeightLbs: 50, cost: 80 }] };
      }
      return { Items: [] };
    });

    const result = await feedInventory(now);
    const poultry = result.feedTypes.find((f) => f.feedType === "poultry");
    expect(poultry.purchasedLbs).toBe(200);
    expect(poultry.avgUnitCost).toBe(0.4);
  });
});

describe("eggCostStats consumptionBasis", () => {
  test("values consumed poultry feed at avg unit cost over lay-month dozens", async () => {
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      // Poultry purchases: 200 lbs for $100 -> $0.50/lb.
      if (pk === "FEED#2026-06") return { Items: [{ feedType: "poultry", totalLbs: 200, cost: 100 }] };
      // Consumption: 48 lbs poultry this month.
      if (pk === "FEEDUSE#2026-06") {
        return { Items: [{ feedType: "poultry", lbs: 48, usedAt: "2026-06-10T00:00:00.000Z" }] };
      }
      // Eggs: 24 collected (2 dozen) -> June is a lay month.
      if (pk === "EGG#2026-06") {
        return { Items: [{ count: 24, collectedAt: "2026-06-01T00:00:00.000Z" }] };
      }
      return { Items: [] };
    });

    const result = await eggCostStats("2026-06", ["2026-06"], { storePricePerDozen: 4 });

    // Original purchase-basis fields preserved.
    expect(result.costPerDozen).toBe(50); // $100 spend / 2 dozen
    expect(result.poultryFeedSpend).toBe(100);

    // Consumption basis: 48 lbs * $0.50/lb = $24 value; / 2 dozen = $12/dozen.
    const cb = result.consumptionBasis;
    expect(cb.avgUnitCost).toBe(0.5);
    expect(cb.consumedLbs).toBe(48);
    expect(cb.consumedValue).toBe(24);
    expect(cb.layMonths).toBe(1);
    expect(cb.dozens).toBe(2);
    expect(cb.costPerDozen).toBe(12);
    expect(cb.savingsPerDozen).toBe(4 - 12);
    expect(cb.cheaperThanStore).toBe(false);
  });

  test("counts only lay months: dozens from months with no eggs are excluded", async () => {
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      if (pk === "FEED#2026-05") return { Items: [{ feedType: "poultry", totalLbs: 100, cost: 100 }] };
      if (pk === "FEEDUSE#2026-05") {
        return { Items: [{ feedType: "poultry", lbs: 20, usedAt: "2026-05-10T00:00:00.000Z" }] };
      }
      if (pk === "FEEDUSE#2026-06") {
        return { Items: [{ feedType: "poultry", lbs: 20, usedAt: "2026-06-10T00:00:00.000Z" }] };
      }
      // Only June has eggs -> May is not a lay month.
      if (pk === "EGG#2026-06") {
        return { Items: [{ count: 12, collectedAt: "2026-06-01T00:00:00.000Z" }] };
      }
      return { Items: [] };
    });

    const result = await eggCostStats("2026", ["2026-05", "2026-06"], { storePricePerDozen: 4 });
    const cb = result.consumptionBasis;
    // avg unit cost $1/lb; consumed 40 lbs -> $40 value; lay-month dozens = 1.
    expect(cb.avgUnitCost).toBe(1);
    expect(cb.consumedLbs).toBe(40);
    expect(cb.consumedValue).toBe(40);
    expect(cb.layMonths).toBe(1);
    expect(cb.dozens).toBe(1);
    expect(cb.costPerDozen).toBe(40);
  });

  test("null consumption cost when no poultry weight was purchased", async () => {
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      if (pk === "FEEDUSE#2026-06") {
        return { Items: [{ feedType: "poultry", lbs: 30, usedAt: "2026-06-10T00:00:00.000Z" }] };
      }
      if (pk === "EGG#2026-06") {
        return { Items: [{ count: 12, collectedAt: "2026-06-01T00:00:00.000Z" }] };
      }
      return { Items: [] };
    });

    const result = await eggCostStats("2026-06", ["2026-06"]);
    const cb = result.consumptionBasis;
    expect(cb.avgUnitCost).toBeNull();
    expect(cb.consumedValue).toBeNull();
    expect(cb.costPerDozen).toBeNull();
  });
});

describe("summaryStats feed block", () => {
  test("adds onHandLbs + daysRemaining while keeping spend/quantity", async () => {
    const now = new Date("2026-06-21T00:00:00.000Z");
    route((input) => {
      const v = input.ExpressionAttributeValues;
      const pk = v[":pk"];
      if (pk === "FEED#2026-06") {
        return { Items: [{ feedType: "poultry", totalLbs: 200, cost: 100, quantity: 200 }] };
      }
      if (pk === "FEEDUSE#2026-06") {
        return { Items: [{ feedType: "poultry", lbs: 60, usedAt: "2026-06-10T00:00:00.000Z" }] };
      }
      return {};
    });

    const summary = await summaryStats(now);

    // Existing fields preserved.
    expect(summary.feed.thisMonthSpend).toBe(100);
    expect(summary.feed.thisMonthQuantity).toBe(200);
    // New composed fields.
    expect(summary.feed.onHandLbs).toBe(140);
    expect(summary.feed.daysRemaining).toBe(70);
  });
});
