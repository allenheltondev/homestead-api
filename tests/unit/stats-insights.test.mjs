import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";

// Mock the shared DynamoDB document client (same harness as stats.test.mjs):
// `send` is routed per-test against fabricated DDB responses so the real
// aggregation logic runs with no AWS call.
const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));
jest.unstable_mockModule("@aws-sdk/lib-dynamodb", () => ({
  QueryCommand: jest.fn((input) => ({ input })),
}));

const {
  mortalityStats,
  mortalitySummary,
  healthStats,
  eggCostStats,
  eggCostByFlock,
} = await import("../../api/domain/stats.mjs");

function route(fn) {
  send.mockImplementation(async (cmd) => fn(cmd.input) ?? {});
}

beforeEach(() => {
  send.mockReset();
});

describe("mortalityStats", () => {
  test("tallies deaths by cause and approximates loss rate over the active herd", async () => {
    route((input) => {
      const v = input.ExpressionAttributeValues;
      const pk = v[":pk"];
      // Herd (GSI2 = ANIMAL): 8 active animals.
      if (input.IndexName === "GSI2" && pk === "ANIMAL") {
        return {
          Items: [
            ...Array.from({ length: 8 }, () => ({ species: "chicken", status: "active" })),
            { species: "chicken", status: "deceased" },
          ],
        };
      }
      // Death events for the month, carrying a `cause`.
      if (input.IndexName === "GSI1" && pk === "EVENT#DEATH#2026-06") {
        return {
          Items: [
            { cause: "predator" },
            { cause: "predator" },
            { cause: "illness" },
            {}, // no cause -> "unknown"
          ],
        };
      }
      return { Items: [] };
    });

    const result = await mortalityStats("2026-06", ["2026-06"]);

    expect(result.period).toBe("2026-06");
    expect(result.totalDeaths).toBe(4);
    expect(result.byCause).toEqual([
      { cause: "predator", count: 2 },
      { cause: "illness", count: 1 },
      { cause: "unknown", count: 1 },
    ]);
    // 4 deaths / (8 active + 4 deaths) = 4/12.
    expect(result.lossRate).toBeCloseTo(4 / 12);
  });

  test("zero deaths yields an empty byCause and zero loss rate (no divide-by-zero)", async () => {
    route((input) => {
      if (input.IndexName === "GSI2") return { Items: [{ status: "active" }] };
      return { Items: [] };
    });
    const result = await mortalityStats("2026-06", ["2026-06"]);
    expect(result.totalDeaths).toBe(0);
    expect(result.byCause).toEqual([]);
    expect(result.lossRate).toBe(0);
  });

  test("mortalitySummary surfaces lossRate + the top cause", async () => {
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      if (input.IndexName === "GSI2") {
        return { Items: Array.from({ length: 4 }, () => ({ status: "active" })) };
      }
      if (pk === "EVENT#DEATH#2026-06") {
        return { Items: [{ cause: "illness" }, { cause: "illness" }, { cause: "cold" }] };
      }
      return { Items: [] };
    });
    const summary = await mortalitySummary("2026-06", ["2026-06"]);
    expect(summary.totalDeaths).toBe(3);
    expect(summary.topCause).toBe("illness");
    expect(summary.lossRate).toBeCloseTo(3 / 7);
  });
});

describe("healthStats", () => {
  test("sums spend, groups by category, and derives per-animal", async () => {
    route((input) => {
      const v = input.ExpressionAttributeValues;
      const pk = v[":pk"];
      if (input.IndexName === "GSI2" && pk === "ANIMAL") {
        return { Items: Array.from({ length: 4 }, () => ({ status: "active" })) };
      }
      if (pk === "HEALTHEXP#2026-06") {
        expect(v[":sk"]).toBe("EXP#");
        return {
          Items: [
            { category: "vaccine", cost: 30 },
            { category: "vaccine", cost: 10 },
            { category: "vet", cost: 100 },
          ],
        };
      }
      return { Items: [] };
    });

    const result = await healthStats("2026-06", ["2026-06"]);
    expect(result.totalSpend).toBe(140);
    expect(result.byCategory).toEqual([
      { category: "vet", amount: 100 },
      { category: "vaccine", amount: 40 },
    ]);
    expect(result.perAnimal).toBe(35); // 140 / 4 active
  });

  test("perAnimal is null when there are no active animals", async () => {
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      if (input.IndexName === "GSI2") return { Items: [] };
      if (pk === "HEALTHEXP#2026-06") return { Items: [{ category: "vet", cost: 50 }] };
      return { Items: [] };
    });
    const result = await healthStats("2026-06", ["2026-06"]);
    expect(result.totalSpend).toBe(50);
    expect(result.perAnimal).toBeNull();
  });
});

describe("eggCostStats with a flock filter", () => {
  test("restricts eggs to coop==flock and poultry feed to flock==flock", async () => {
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      if (pk === "EGG#2026-06") {
        return {
          Items: [
            { count: 24, collectedAt: "2026-06-01T00:00:00.000Z", coop: "north" },
            { count: 36, collectedAt: "2026-06-02T00:00:00.000Z", coop: "south" },
          ],
        };
      }
      if (pk === "FEED#2026-06") {
        return {
          Items: [
            { feedType: "poultry", cost: 30, flock: "north" },
            { feedType: "poultry", cost: 90, flock: "south" },
          ],
        };
      }
      return { Items: [] };
    });

    const result = await eggCostStats("2026-06", ["2026-06"], {
      storePricePerDozen: 4,
      flock: "north",
    });
    expect(result.flock).toBe("north");
    expect(result.eggs).toBe(24); // only the north coop
    expect(result.dozens).toBe(2);
    expect(result.poultryFeedSpend).toBe(30); // only the north flock feed
    expect(result.costPerDozen).toBe(15);
  });

  test("no-flock behavior is unchanged (no flock field, all coops counted)", async () => {
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      if (pk === "EGG#2026-06") {
        return {
          Items: [
            { count: 24, collectedAt: "2026-06-01T00:00:00.000Z", coop: "north" },
            { count: 12, collectedAt: "2026-06-02T00:00:00.000Z" },
          ],
        };
      }
      if (pk === "FEED#2026-06") {
        return { Items: [{ feedType: "poultry", cost: 36, flock: "north" }] };
      }
      return { Items: [] };
    });

    const result = await eggCostStats("2026-06", ["2026-06"], { storePricePerDozen: 4 });
    expect(result.flock).toBeUndefined();
    expect(result.eggs).toBe(36); // both collections
    expect(result.poultryFeedSpend).toBe(36); // all poultry feed regardless of flock
    expect(result.costPerDozen).toBe(12);
  });
});

describe("eggCostByFlock", () => {
  test("returns one row per coop seen in the period's eggs", async () => {
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      if (pk === "EGG#2026-06") {
        return {
          Items: [
            { count: 24, collectedAt: "2026-06-01T00:00:00.000Z", coop: "north" },
            { count: 60, collectedAt: "2026-06-02T00:00:00.000Z", coop: "south" },
          ],
        };
      }
      if (pk === "FEED#2026-06") {
        return {
          Items: [
            { feedType: "poultry", cost: 20, flock: "north" },
            { feedType: "poultry", cost: 25, flock: "south" },
          ],
        };
      }
      return { Items: [] };
    });

    const rows = await eggCostByFlock("2026-06", ["2026-06"], { storePricePerDozen: 4 });
    expect(rows.map((r) => r.flock)).toEqual(["north", "south"]);
    const north = rows.find((r) => r.flock === "north");
    expect(north.dozens).toBe(2);
    expect(north.poultryFeedSpend).toBe(20);
    expect(north.costPerDozen).toBe(10);
    const south = rows.find((r) => r.flock === "south");
    expect(south.dozens).toBe(5);
    expect(south.poultryFeedSpend).toBe(25);
    expect(south.costPerDozen).toBe(5);
    expect(rows[0]).toHaveProperty("consumptionBasis");
  });

  test("empty when no eggs carry a coop", async () => {
    route((input) => {
      const pk = input.ExpressionAttributeValues[":pk"];
      if (pk === "EGG#2026-06") {
        return { Items: [{ count: 12, collectedAt: "2026-06-01T00:00:00.000Z" }] };
      }
      return { Items: [] };
    });
    const rows = await eggCostByFlock("2026-06", ["2026-06"]);
    expect(rows).toEqual([]);
  });
});
