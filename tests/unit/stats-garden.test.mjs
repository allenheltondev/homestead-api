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

// gardenStats issues, per month: harvest query (base table) then plantings GSI
// then beds GSI. With a single-month period that is 3 queries.
function mockGarden({ harvests, plantings = [], beds = [] }) {
  send.mockImplementation((cmd) => {
    const pk = cmd.input.ExpressionAttributeValues?.[":pk"];
    if (typeof pk === "string" && pk.startsWith("HARVEST#")) return { Items: harvests };
    if (pk === "PLANTING") return { Items: plantings };
    if (pk === "BED") return { Items: beds };
    return { Items: [] };
  });
}

describe("gardenStats", () => {
  test("totals lbs by crop (oz -> lb) and yields per bed via planting->bed join", async () => {
    mockGarden({
      harvests: [
        { cropName: "Tomato", quantity: 5, unit: "lb", plantingId: "p1" },
        { cropName: "Tomato", quantity: 16, unit: "oz", plantingId: "p1" },
        { cropName: "Basil", quantity: 4, unit: "bunch" },
      ],
      plantings: [{ id: "p1", bedId: "b1" }],
      beds: [{ id: "b1", name: "North" }],
    });

    const stats = await gardenStats("2026-06", ["2026-06"]);
    expect(stats.totalLbs).toBeCloseTo(6); // 5 + 1
    const tomato = stats.byCrop.find((c) => c.cropName === "Tomato");
    expect(tomato.lbs).toBeCloseTo(6);
    const basil = stats.byCrop.find((c) => c.cropName === "Basil");
    expect(basil.lbs).toBe(0);
    expect(basil.count).toBe(4);

    const north = stats.yieldByBed.find((b) => b.bedId === "b1");
    expect(north.name).toBe("North");
    expect(north.lbs).toBeCloseTo(6);
  });

  test("logs with no planting roll up under unassigned", async () => {
    mockGarden({ harvests: [{ cropName: "Kale", quantity: 2, unit: "lb" }] });
    const stats = await gardenStats("2026-06", ["2026-06"]);
    expect(stats.yieldByBed[0].bedId).toBeNull();
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
