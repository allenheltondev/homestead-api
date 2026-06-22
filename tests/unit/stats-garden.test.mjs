import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";

const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));

// gardenStats + the P&L produce value now source from GRN: list the user's
// crops, fetch each crop's harvests, sum amount by crop, filter by harvestedOn.
const listGrowerCrops = jest.fn();
const listCropHarvests = jest.fn();
jest.unstable_mockModule("../../api/lib/grn.mjs", () => ({ listGrowerCrops, listCropHarvests }));

const { gardenStats, pnlStats, resolveProducePricePerLb } = await import("../../api/domain/stats.mjs");
const { GrnNotConfiguredError, GrnUnauthorizedError } = await import("../../api/services/errors.mjs");

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ Items: [] });
  listGrowerCrops.mockReset();
  listCropHarvests.mockReset();
  delete process.env.PRODUCE_PRICE_PER_LB;
});

describe("gardenStats (GRN-sourced)", () => {
  test("sums harvest amount by crop for harvests in the period, surfaces cropLibraryId", async () => {
    listGrowerCrops.mockResolvedValue([
      { id: "gc-1", crop_name: "Tomato" },
      { id: "gc-2", crop_name: "Basil", nickname: "Sweet Basil" },
    ]);
    listCropHarvests.mockImplementation(async (id) => {
      if (id === "gc-1") {
        return {
          growerCropId: "gc-1",
          harvests: [
            { amount: "5", harvestedOn: "2026-06-10" },
            { amount: "1", harvestedOn: "2026-06-20" },
            { amount: "9", harvestedOn: "2026-05-01" }, // out of period
          ],
        };
      }
      return { growerCropId: "gc-2", harvests: [{ amount: "4", harvestedOn: "2026-06-02" }] };
    });

    const stats = await gardenStats("2026-06", ["2026-06"]);
    expect(stats.totalLbs).toBeCloseTo(10); // 5 + 1 + 4

    const tomato = stats.byCrop.find((c) => c.cropName === "Tomato");
    expect(tomato.lbs).toBeCloseTo(6);
    expect(tomato.cropLibraryId).toBe("gc-1");

    // nickname wins for the display name.
    const basil = stats.byCrop.find((c) => c.cropName === "Sweet Basil");
    expect(basil.lbs).toBe(4);
    expect(basil.cropLibraryId).toBe("gc-2");

    expect(stats).not.toHaveProperty("yieldByBed");
  });

  test("crops with no in-period harvest are omitted", async () => {
    listGrowerCrops.mockResolvedValue([{ id: "gc-1", crop_name: "Tomato" }]);
    listCropHarvests.mockResolvedValue({ harvests: [{ amount: "3", harvestedOn: "2025-01-01" }] });
    const stats = await gardenStats("2026-06", ["2026-06"]);
    expect(stats.totalLbs).toBe(0);
    expect(stats.byCrop).toEqual([]);
  });

  test("degrades to an empty garden when GRN is not configured", async () => {
    listGrowerCrops.mockRejectedValue(new GrnNotConfiguredError());
    const stats = await gardenStats("2026-06", ["2026-06"]);
    expect(stats).toEqual({ period: "2026-06", totalLbs: 0, byCrop: [] });
  });

  test("degrades to an empty garden when GRN is unauthorized", async () => {
    listGrowerCrops.mockRejectedValue(new GrnUnauthorizedError(403));
    const stats = await gardenStats("2026-06", ["2026-06"]);
    expect(stats.totalLbs).toBe(0);
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

describe("pnlStats produce tie-in (GRN-sourced)", () => {
  test("produceValue is 0 by default and outputs keep prior fields", async () => {
    listGrowerCrops.mockResolvedValue([]);
    const out = await pnlStats("2026-06", ["2026-06"]);
    expect(out.outputs.produceValue).toBe(0);
    expect(out.outputs).toHaveProperty("eggsValue");
    expect(out.outputs).toHaveProperty("salesRevenue");
    expect(out.prices.producePricePerLb).toBe(0);
  });

  test("produceValue = GRN harvest amount x price when price supplied", async () => {
    listGrowerCrops.mockResolvedValue([{ id: "gc-1", crop_name: "Tomato" }]);
    listCropHarvests.mockResolvedValue({ harvests: [{ amount: "10", harvestedOn: "2026-06-15" }] });
    const out = await pnlStats("2026-06", ["2026-06"], { producePricePerLb: 2 });
    expect(out.outputs.produceValue).toBe(20);
    expect(out.outputs.total).toBe(20);
  });

  test("produceValue degrades to 0 (P&L not failed) when GRN unconfigured", async () => {
    listGrowerCrops.mockRejectedValue(new GrnNotConfiguredError());
    const out = await pnlStats("2026-06", ["2026-06"], { producePricePerLb: 2 });
    expect(out.outputs.produceValue).toBe(0);
  });
});
