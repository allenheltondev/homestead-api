import { request } from "./client.mjs";
import { track, cleanup, ns } from "./_helpers.mjs";

// Runs ONLY via `npm run test:integration` against a deployed staging stack
// (STAGE_API_URL). Excluded from `npm test` (jest.config roots at tests/unit).

afterEach(cleanup);
afterAll(cleanup);

// Namespace the vendor so this run's purchases are distinguishable from any
// other data sharing the staging table.
const VENDOR = ns("feed-vendor");

async function createPurchase(overrides = {}) {
  const body = {
    type: "hay",
    quantity: 10,
    unit: "bale",
    cost: 120,
    vendor: VENDOR,
    purchasedAt: "2026-03-15T12:00:00.000Z",
    ...overrides,
  };
  const created = await request("POST", "/feed-purchases", body);
  expect(created.status).toBe(201);
  const id = created.body?.id;
  expect(id).toBeTruthy();
  track(`/feed-purchases/${id}`);
  return created.body;
}

describe("feed purchases", () => {
  test("create -> range query -> type filter -> delete", async () => {
    // Two distinct months and two types so the range fan-out and the GSI1
    // type filter both have something to find.
    const march = await createPurchase({
      type: "hay",
      purchasedAt: "2026-03-15T12:00:00.000Z",
    });
    const may = await createPurchase({
      type: "grain",
      purchasedAt: "2026-05-10T08:00:00.000Z",
    });

    // Range spanning both months returns both (filter to our vendor since the
    // table is shared).
    const ranged = await request(
      "GET",
      "/feed-purchases?from=2026-03&to=2026-05",
    );
    expect(ranged.status).toBe(200);
    const rangedMine = (ranged.body?.feed_purchases ?? []).filter(
      (p) => p.vendor === VENDOR,
    );
    const rangedIds = rangedMine.map((p) => p.id);
    expect(rangedIds).toEqual(expect.arrayContaining([march.id, may.id]));

    // Narrower range excludes May.
    const marchOnly = await request(
      "GET",
      "/feed-purchases?from=2026-03&to=2026-03",
    );
    expect(marchOnly.status).toBe(200);
    const marchMine = (marchOnly.body?.feed_purchases ?? []).filter(
      (p) => p.vendor === VENDOR,
    );
    expect(marchMine.map((p) => p.id)).toContain(march.id);
    expect(marchMine.map((p) => p.id)).not.toContain(may.id);

    // Type filter via GSI1 returns only the grain purchase.
    const grain = await request("GET", "/feed-purchases?type=grain");
    expect(grain.status).toBe(200);
    const grainMine = (grain.body?.feed_purchases ?? []).filter(
      (p) => p.vendor === VENDOR,
    );
    expect(grainMine.map((p) => p.id)).toContain(may.id);
    expect(grainMine.map((p) => p.id)).not.toContain(march.id);

    // Delete one explicitly and confirm 204 (cleanup() handles the rest).
    const deleted = await request("DELETE", `/feed-purchases/${march.id}`);
    expect(deleted.status).toBe(204);
  });
});
