import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";

// Mock the shared DynamoDB doc client so the read-only stats/careTask
// aggregations the copilot tools call run against canned query results (no real
// DynamoDB). Each REGISTRY handler exercises the real domain function.
const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));

// GRN is an optional outbound integration; mock its client so the my-listings
// tool can be driven without hitting an external service.
const isGrnConfigured = jest.fn();
const listMyListings = jest.fn();
jest.unstable_mockModule("../../api/lib/grn.mjs", () => ({
  isGrnConfigured,
  listMyListings,
  listGrowerCrops: jest.fn().mockResolvedValue([]),
  listCropHarvests: jest.fn().mockResolvedValue({ harvests: [] }),
}));

const { TOOL_SPECS, REGISTRY } = await import("../../api/copilot/tools.mjs");

beforeEach(() => {
  send.mockReset();
  isGrnConfigured.mockReset();
  listMyListings.mockReset();
});

// Helper: make ddb.send resolve a single page of Items, then drain.
function mockQueryItems(items) {
  send.mockResolvedValue({ Items: items, Count: items.length });
}

describe("TOOL_SPECS", () => {
  test("every spec has a matching REGISTRY handler and well-formed schema", () => {
    expect(TOOL_SPECS.length).toBeGreaterThan(0);
    for (const { toolSpec } of TOOL_SPECS) {
      expect(typeof toolSpec.name).toBe("string");
      expect(typeof toolSpec.description).toBe("string");
      expect(toolSpec.inputSchema.json.type).toBe("object");
      expect(typeof REGISTRY[toolSpec.name]).toBe("function");
    }
  });

  test("every REGISTRY entry is exposed as a toolSpec (no orphans)", () => {
    const specNames = new Set(TOOL_SPECS.map((t) => t.toolSpec.name));
    for (const name of Object.keys(REGISTRY)) {
      expect(specNames.has(name)).toBe(true);
    }
  });
});

describe("get_herd_summary", () => {
  test("tallies animals by species and status", async () => {
    mockQueryItems([
      { species: "goat", status: "active" },
      { species: "goat", status: "deceased" },
      { species: "chicken", status: "active" },
    ]);
    const out = await REGISTRY.get_herd_summary({});
    expect(out.total).toBe(3);
    expect(out.byStatus.active).toBe(2);
    expect(out.bySpecies.goat.total).toBe(2);
    expect(out.bySpecies.goat.deceased).toBe(1);
  });
});

describe("get_egg_stats", () => {
  test("sums eggs for the resolved period", async () => {
    mockQueryItems([
      { count: 6, collectedAt: "2026-06-01T08:00:00.000Z", birdType: "chicken" },
      { count: 6, collectedAt: "2026-06-02T08:00:00.000Z", birdType: "chicken" },
    ]);
    const out = await REGISTRY.get_egg_stats({ period: "2026-06" });
    expect(out.period).toBe("2026-06");
    expect(out.totalEggs).toBe(12);
    expect(out.dozens).toBe(1);
    expect(out.days).toBe(2);
  });

  test("defaults to the current month when period is omitted", async () => {
    mockQueryItems([]);
    const out = await REGISTRY.get_egg_stats({});
    expect(out.period).toMatch(/^\d{4}-\d{2}$/);
    expect(out.totalEggs).toBe(0);
  });
});

describe("get_feed_inventory", () => {
  test("composes purchases and consumption into on-hand by feed type", async () => {
    // feedInventory fans out a purchase Query per month over a wide lifetime
    // range. Return the purchase for exactly ONE FEED# partition so the
    // aggregation isn't multiplied across months; everything else is empty.
    let purchaseReturned = false;
    send.mockImplementation((cmd) => {
      const pk = cmd?.input?.ExpressionAttributeValues?.[":pk"] ?? "";
      if (pk.startsWith("FEED#") && !purchaseReturned) {
        purchaseReturned = true;
        return Promise.resolve({
          Items: [{ type: "poultry", totalLbs: 100, cost: 50 }],
        });
      }
      return Promise.resolve({ Items: [] });
    });
    const out = await REGISTRY.get_feed_inventory({});
    const poultry = out.feedTypes.find((f) => f.feedType === "poultry");
    expect(poultry.purchasedLbs).toBe(100);
    expect(poultry.onHandLbs).toBe(100);
    expect(out.totals.onHandLbs).toBe(100);
  });
});

describe("get_care_tasks_due", () => {
  test("returns due tasks within the default window", async () => {
    mockQueryItems([
      { id: "t1", title: "Worm goats", category: "health", target: "herd", nextDueAt: "2026-06-23T00:00:00.000Z" },
    ]);
    const out = await REGISTRY.get_care_tasks_due({});
    expect(out.withinDays).toBe(7);
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0].title).toBe("Worm goats");
  });

  test("honors an explicit withinDays", async () => {
    mockQueryItems([]);
    const out = await REGISTRY.get_care_tasks_due({ withinDays: 30 });
    expect(out.withinDays).toBe(30);
    expect(out.tasks).toEqual([]);
  });
});

describe("get_grn_my_listings", () => {
  test("returns an empty list (best-effort) when GRN is not configured", async () => {
    isGrnConfigured.mockReturnValue(false);
    const out = await REGISTRY.get_grn_my_listings({});
    expect(out).toEqual({ configured: false, listings: [] });
    expect(listMyListings).not.toHaveBeenCalled();
  });

  test("maps GRN listings when configured", async () => {
    isGrnConfigured.mockReturnValue(true);
    listMyListings.mockResolvedValue({
      items: [{ id: "l1", title: "Tomatoes", status: "open" }],
    });
    const out = await REGISTRY.get_grn_my_listings({ status: "open" });
    expect(out.configured).toBe(true);
    expect(out.listings).toEqual([{ id: "l1", title: "Tomatoes", status: "open" }]);
    expect(listMyListings).toHaveBeenCalledWith({ status: "open", limit: 100 });
  });

  test("degrades to empty on a GRN auth error", async () => {
    isGrnConfigured.mockReturnValue(true);
    const { GrnUnauthorizedError } = await import("../../api/services/errors.mjs");
    listMyListings.mockRejectedValue(new GrnUnauthorizedError(401));
    const out = await REGISTRY.get_grn_my_listings({});
    expect(out).toEqual({ configured: false, listings: [] });
  });
});
