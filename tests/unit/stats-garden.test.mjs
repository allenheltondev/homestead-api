import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";

const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));

const { gardenStats, pnlStats, resolveProducePricePerLb } = await import("../../api/domain/stats.mjs");

beforeEach(() => {
  send.mockReset();
  delete process.env.PRODUCE_PRICE_PER_LB;
});

// gardenStats issues, per month, one harvest query (base table). Crops + beds
// live in GRN now, so there is no planting/bed join.
function mockGarden({ harvests }) {
  send.mockImplementation((cmd) => {
    const pk = cmd.input.ExpressionAttributeValues?.[":pk"];
    if (typeof pk === "string" && pk.startsWith("HARVEST#")) return { Items: harvests };
    return { Items: [] };
  });
}

describe("gardenStats", () => {
  test("totals lbs by crop name (oz -> lb), counts count-units, surfaces cropLibraryId", async () => {
    mockGarden({
      harvests: [
        { cropName: "Tomato", quantity: 5, unit: "lb", cropLibraryId: "gc-1" },
        { cropName: "Tomato", quantity: 16, unit: "oz" },
        { cropName: "Basil", quantity: 4, unit: "bunch" },
      ],
    });

    const stats = await gardenStats("2026-06", ["2026-06"]);
    expect(stats.totalLbs).toBeCloseTo(6); // 5 + 1
    expect(stats).not.toHaveProperty("yieldByBed");

    const tomato = stats.byCrop.find((c) => c.cropName === "Tomato");
    expect(tomato.lbs).toBeCloseTo(6);
    expect(tomato.cropLibraryId).toBe("gc-1");

    const basil = stats.byCrop.find((c) => c.cropName === "Basil");
    expect(basil.lbs).toBe(0);
    expect(basil.count).toBe(4);
    expect(basil.cropLibraryId).toBeNull();
  });

  test("logs with no crop name roll up under unknown", async () => {
    mockGarden({ harvests: [{ quantity: 2, unit: "lb" }] });
    const stats = await gardenStats("2026-06", ["2026-06"]);
    expect(stats.byCrop[0].cropName).toBe("unknown");
  });
});

describe("resolveProducePricePerLb", () => {
  test("defaults to 0 (off) unless param/env set", () => {
    expect(resolveProducePricePerLb()).toBe(0);
    process.env.PRODUCE_PRICE_PER_LB = "3.5";
    expect(resolveProducePricePerLb()).toBe(3.5);
    expect(resolveProducePricePerLb(2)).toBe(2);
  });
});

describe("pnlStats produce tie-in", () => {
  test("produceValue is 0 by default and outputs keep prior fields", async () => {
    send.mockResolvedValue({ Items: [] });
    const out = await pnlStats("2026-06", ["2026-06"]);
    expect(out.outputs.produceValue).toBe(0);
    expect(out.outputs).toHaveProperty("eggsValue");
    expect(out.outputs).toHaveProperty("salesRevenue");
    expect(out.prices.producePricePerLb).toBe(0);
  });

  test("produceValue = harvest lbs x price when price supplied", async () => {
    send.mockImplementation((cmd) => {
      const pk = cmd.input.ExpressionAttributeValues?.[":pk"];
      if (typeof pk === "string" && pk.startsWith("HARVEST#")) {
        return { Items: [{ cropName: "Tomato", quantity: 10, unit: "lb" }] };
      }
      return { Items: [] };
    });
    const out = await pnlStats("2026-06", ["2026-06"], { producePricePerLb: 2 });
    expect(out.outputs.produceValue).toBe(20);
    expect(out.outputs.total).toBe(20);
  });
});
