import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";
process.env.EVENT_BUS_NAME = "default";

const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));

const {
  milkStats,
  milkCostStats,
  eggStats,
  incubationStats,
  growoutStats,
  pnlStats,
} = await import("../../api/domain/stats.mjs");

beforeEach(() => {
  send.mockReset();
  delete process.env.MILK_PRICE_PER_GALLON;
  delete process.env.MEAT_PRICE_PER_LB;
  delete process.env.STORE_EGG_PRICE_PER_DOZEN;
});

// Routes ddb.send by the partition pk in the request so a single test can
// stand in for multiple month/collection partitions.
function routeByPk(map) {
  send.mockImplementation((cmd) => {
    const pk = cmd.input.ExpressionAttributeValues?.[":pk"];
    return Promise.resolve({ Items: map[pk] ?? [] });
  });
}

describe("milkStats", () => {
  test("normalizes volumes to gallons; per-animal + per-day", async () => {
    routeByPk({
      "MILK#2026-06": [
        { volume: 1, unit: "gallon", animalId: "Bessie", loggedAt: "2026-06-01T00:00:00.000Z" },
        { volume: 4, unit: "quart", animalId: "Bessie", loggedAt: "2026-06-01T12:00:00.000Z" }, // 1 gal
        { volume: 2, unit: "gallon", animalId: "Daisy", loggedAt: "2026-06-02T00:00:00.000Z" },
      ],
    });
    const result = await milkStats("2026-06", ["2026-06"]);
    expect(result.totalGallons).toBeCloseTo(4, 5);
    expect(result.loggingDays).toBe(2);
    expect(result.avgGallonsPerDay).toBeCloseTo(2, 5);
    const bessie = result.perAnimal.find((a) => a.animalId === "Bessie");
    expect(bessie.gallons).toBeCloseTo(2, 5);
  });
});

describe("milkCostStats", () => {
  test("divides goat feed spend by gallons -> cost per gallon", async () => {
    routeByPk({
      "MILK#2026-06": [
        { volume: 10, unit: "gallon", loggedAt: "2026-06-01T00:00:00.000Z" },
      ],
      "FEED#2026-06": [
        { feedType: "goat", cost: 50 },
        { feedType: "poultry", cost: 99 }, // not goat -> ignored
      ],
    });
    const result = await milkCostStats("2026-06", ["2026-06"], { milkPricePerGallon: 8 });
    expect(result.gallons).toBe(10);
    expect(result.goatFeedSpend).toBe(50);
    expect(result.costPerGallon).toBe(5);
    expect(result.cheaperThanStore).toBe(true);
  });

  test("null cost figures when no gallons", async () => {
    routeByPk({ "FEED#2026-06": [{ feedType: "goat", cost: 50 }] });
    const result = await milkCostStats("2026-06", ["2026-06"]);
    expect(result.costPerGallon).toBeNull();
  });
});

describe("eggStats byBirdType", () => {
  test("breaks down by bird type; legacy rows count as chicken", async () => {
    routeByPk({
      "EGG#2026-06": [
        { count: 12, collectedAt: "2026-06-01T00:00:00.000Z" }, // legacy -> chicken
        { count: 6, birdType: "duck", collectedAt: "2026-06-01T00:00:00.000Z" },
        { count: 6, birdType: "duck", collectedAt: "2026-06-02T00:00:00.000Z" },
      ],
    });
    const result = await eggStats(["2026-06"]);
    expect(result.totalEggs).toBe(24);
    const byType = Object.fromEntries(result.byBirdType.map((b) => [b.birdType, b.eggs]));
    expect(byType).toEqual({ chicken: 12, duck: 12 });
  });

  test("birdType filter restricts the totals", async () => {
    routeByPk({
      "EGG#2026-06": [
        { count: 12, birdType: "chicken", collectedAt: "2026-06-01T00:00:00.000Z" },
        { count: 6, birdType: "duck", collectedAt: "2026-06-01T00:00:00.000Z" },
      ],
    });
    const result = await eggStats(["2026-06"], { birdType: "duck" });
    expect(result.totalEggs).toBe(6);
  });
});

describe("incubationStats", () => {
  test("counts active batches + overall hatch rate", async () => {
    routeByPk({
      INCUBATION: [
        { id: "a", status: "incubating", count: 12, species: "chicken", setAt: "x", expectedHatchAt: "y" },
        { id: "b", status: "hatched", count: 10, hatchedCount: 8 },
        { id: "c", status: "partial", count: 10, hatchedCount: 2 },
      ],
    });
    const result = await incubationStats();
    expect(result.activeBatches).toBe(1);
    expect(result.eggsSetWithOutcome).toBe(20);
    expect(result.totalHatched).toBe(10);
    expect(result.hatchRate).toBe(0.5);
  });
});

describe("growoutStats", () => {
  test("active + processed yield; optional cost-to-raise with period", async () => {
    routeByPk({
      GROWOUT: [
        { id: "a", status: "raising", count: 50, species: "broiler", purpose: "meat", startedAt: "x" },
        { id: "b", status: "processed", dressedWeightLbsTotal: 200, processedCount: 48 },
      ],
      "FEED#2026-06": [{ feedType: "poultry", cost: 100 }],
    });
    const result = await growoutStats(["2026-06"]);
    expect(result.activeBatches).toBe(1);
    expect(result.processedBatches).toBe(1);
    expect(result.dressedWeightLbsTotal).toBe(200);
    expect(result.feedSpend).toBe(100);
    expect(result.costToRaisePerLb).toBe(0.5);
  });

  test("no period -> no feed cost block", async () => {
    routeByPk({ GROWOUT: [] });
    const result = await growoutStats();
    expect(result.feedSpend).toBeUndefined();
  });
});

describe("pnlStats", () => {
  test("composes costs, outputs (incl actual sales), and net", async () => {
    routeByPk({
      // feed spend (feedStats + goat/poultry helpers read FEED#)
      "FEED#2026-06": [{ type: "poultry", feedType: "poultry", cost: 100, quantity: 0 }],
      // health spend
      "HEALTHEXP#2026-06": [{ category: "vet", cost: 50 }],
      // eggs -> 24 eggs = 2 dozen
      "EGG#2026-06": [{ count: 24, collectedAt: "2026-06-01T00:00:00.000Z" }],
      // milk -> 5 gallons
      "MILK#2026-06": [{ volume: 5, unit: "gallon", loggedAt: "2026-06-01T00:00:00.000Z" }],
      // grow-out processed -> 100 dressed lbs
      GROWOUT: [{ id: "b", status: "processed", dressedWeightLbsTotal: 100 }],
      // actual sales -> 30
      "SALE#2026-06": [{ amount: 30 }],
      // herd (healthStats composes herdStats via GSI2 ANIMAL)
      ANIMAL: [{ status: "active" }],
    });

    const result = await pnlStats("2026-06", ["2026-06"], {
      storePricePerDozen: 4,
      milkPricePerGallon: 8,
      meatPricePerLb: 6,
    });

    expect(result.costs.feedSpend).toBe(100);
    expect(result.costs.healthSpend).toBe(50);
    expect(result.costs.total).toBe(150);

    // eggsValue = 2 doz * 4 = 8; milkValue = 5 * 8 = 40; meatValue = 100 * 6 = 600; sales = 30
    expect(result.outputs.eggsValue).toBe(8);
    expect(result.outputs.milkValue).toBe(40);
    expect(result.outputs.meatValue).toBe(600);
    expect(result.outputs.salesRevenue).toBe(30);
    expect(result.outputs.total).toBe(678);
    expect(result.net).toBe(528);
  });
});
