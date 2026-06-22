// Focused tests for the Nova Pro tool registry (lib/tools.mjs), covering the
// garden + Good Roots Network additions: tool specs are exposed, READ/WRITE
// runners map to the right api.mjs methods, and the argument normalizers keep
// only valid fields. The existing animal tools are still asserted present so a
// regression that drops them is caught here.

import { jest } from "@jest/globals";

import { TOOL_SPECS, REGISTRY, __testables } from "../lib/tools.mjs";

const specNames = TOOL_SPECS.map((t) => t.toolSpec.name);

describe("tool specs", () => {
  test("keeps the pre-existing animal tools", () => {
    for (const name of [
      "get_summary",
      "get_herd",
      "log_feed_purchase",
      "record_birth",
      "record_death",
      "log_milk",
      "complete_care_task",
    ]) {
      expect(specNames).toContain(name);
      expect(REGISTRY[name]).toBeDefined();
    }
  });

  test("adds the garden + GRN tools", () => {
    for (const name of [
      "get_garden_stats",
      "get_grn_listings",
      "get_grn_requests",
      "log_harvest",
      "publish_surplus",
    ]) {
      expect(specNames).toContain(name);
      expect(REGISTRY[name]).toBeDefined();
    }
  });

  test("get_* garden/GRN tools are read, log_harvest/publish_surplus are write", () => {
    expect(REGISTRY.get_garden_stats.kind).toBe("read");
    expect(REGISTRY.get_grn_listings.kind).toBe("read");
    expect(REGISTRY.get_grn_requests.kind).toBe("read");
    expect(REGISTRY.log_harvest.kind).toBe("write");
    expect(REGISTRY.publish_surplus.kind).toBe("write");
  });
});

describe("garden/GRN runners", () => {
  test("read runners call the matching api method", async () => {
    const api = {
      getGardenStats: jest.fn().mockResolvedValue({ total: 1 }),
      getGrnListings: jest.fn().mockResolvedValue({ listings: [] }),
      getGrnRequests: jest.fn().mockResolvedValue({ requests: [] }),
    };
    await REGISTRY.get_garden_stats.run({ period: "this month" }, api);
    expect(api.getGardenStats).toHaveBeenCalledWith({ period: "this month" });
    await REGISTRY.get_grn_listings.run({}, api);
    expect(api.getGrnListings).toHaveBeenCalledTimes(1);
    await REGISTRY.get_grn_requests.run({}, api);
    expect(api.getGrnRequests).toHaveBeenCalledTimes(1);
  });

  test("log_harvest runner resolves the crop and posts the GRN harvest body", async () => {
    const api = {
      listGrnCrops: jest
        .fn()
        .mockResolvedValue({ crops: [{ id: "c1", name: "Tomatoes" }] }),
      recordHarvest: jest.fn().mockResolvedValue({}),
    };
    await REGISTRY.log_harvest.run(
      { crop: "tomatoes", amount: 5, unit: "pound" },
      api,
    );
    expect(api.recordHarvest).toHaveBeenCalledWith({
      cropLibraryId: "c1",
      amount: 5,
      unit: "pound",
    });
    expect(REGISTRY.log_harvest.describe({ crop: "tomatoes", amount: 5 })).toMatch(
      /tomatoes/,
    );
  });

  test("log_harvest runner throws a helpful error when the crop isn't found", async () => {
    const api = {
      listGrnCrops: jest.fn().mockResolvedValue({ crops: [] }),
      recordHarvest: jest.fn(),
    };
    await expect(
      REGISTRY.log_harvest.run({ crop: "dragonfruit", amount: 1 }, api),
    ).rejects.toThrow(/dragonfruit/);
    expect(api.recordHarvest).not.toHaveBeenCalled();
  });

  test("publish_surplus runner resolves the crop and rides quantity along", async () => {
    const api = {
      listGrnCrops: jest
        .fn()
        .mockResolvedValue({ crops: [{ id: "c1", name: "Tomatoes" }] }),
      publishSurplus: jest.fn().mockResolvedValue({}),
    };
    await REGISTRY.publish_surplus.run({ crop: "tomatoes", quantity: 3 }, api);
    expect(api.publishSurplus).toHaveBeenCalledWith("c1", {
      quantity: 3,
    });
    expect(
      REGISTRY.publish_surplus.describe({ crop: "tomatoes" }),
    ).toMatch(/Good Roots Network/);
  });
});

describe("garden normalizers", () => {
  test("cleanHarvest keeps the amount + unit and defaults the unit", () => {
    expect(__testables.cleanHarvest({ amount: 2 })).toEqual({
      amount: 2,
      unit: "lb",
    });
    expect(__testables.cleanHarvest({ amount: "x" })).toEqual({});
  });

  test("cleanSurplus drops empty quantity/unit", () => {
    expect(__testables.cleanSurplus({ quantity: 4, unit: "lb" })).toEqual({
      quantity: 4,
      unit: "lb",
    });
    expect(__testables.cleanSurplus({})).toEqual({});
  });
});
