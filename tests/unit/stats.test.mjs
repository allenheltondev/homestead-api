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
      // Feed this month.
      if (pk === "FEED#2026-06") {
        return { Items: [{ type: "hay", cost: 75, quantity: 4 }] };
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
    expect(summary.feed).toEqual({ thisMonthSpend: 75, thisMonthQuantity: 4 });
    expect(summary.pastures).toEqual({
      total: 2,
      occupancy: [{ name: "North Field", count: 2 }],
    });
  });
});
