import { request } from "./client.mjs";
import { track, cleanup, ns } from "./_helpers.mjs";

// Runs ONLY via `npm run test:integration` against a deployed staging stack
// (STAGE_API_URL). Excluded from `npm test` (jest.config roots at tests/unit).
//
// The egg analytics endpoints are read-only, so this suite seeds via the egg
// + feed write endpoints, then asserts the aggregates move in the right
// direction. The staging table is shared, so we assert on deltas (>=) rather
// than absolute totals. Everything created is track()ed for DELETE cleanup.

afterEach(cleanup);
afterAll(cleanup);

// A fixed far-past month so this run's seeds don't collide with real data and
// the deltas are easy to reason about.
const PERIOD = "2026-02";
const DATE = "2026-02-14";

async function seedEggs(count, date = DATE) {
  const res = await request("POST", "/egg-collections", { count, date, coop: ns("coop") });
  expect(res.status).toBe(201);
  if (res.body?.id) track(`/egg-collections/${res.body.id}`);
  return res.body;
}

async function seedPoultryFeed(cost, date = DATE) {
  const res = await request("POST", "/feed-purchases", {
    bags: 1,
    bagWeightLbs: 50,
    feedType: "layer",
    cost,
    date,
  });
  expect(res.status).toBe(201);
  if (res.body?.id) track(`/feed-purchases/${res.body.id}`);
  return res.body;
}

describe("GET /stats/eggs", () => {
  test("seeded collections increment totalEggs / dozens for the period", async () => {
    const before = await request("GET", `/stats/eggs?period=${PERIOD}`);
    expect(before.status).toBe(200);
    expect(before.body).toHaveProperty("totalEggs");
    expect(before.body).toHaveProperty("dozens");
    expect(before.body).toHaveProperty("days");
    expect(before.body).toHaveProperty("perDay");

    await seedEggs(24);

    const after = await request("GET", `/stats/eggs?period=${PERIOD}`);
    expect(after.status).toBe(200);
    expect(after.body.totalEggs).toBeGreaterThanOrEqual(before.body.totalEggs + 24);
    expect(after.body.dozens).toBeGreaterThanOrEqual(before.body.dozens + 2);
  });
});

describe("GET /stats/egg-cost", () => {
  test("composes poultry feed spend with egg dozens into cost per dozen", async () => {
    // Seed a clean basis in the period: 120 eggs (10 dozen) + $10 poultry feed.
    await seedEggs(120);
    await seedPoultryFeed(10);

    const res = await request(
      "GET",
      `/stats/egg-cost?period=${PERIOD}&storePricePerDozen=4`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ period: PERIOD, storePricePerDozen: 4 });
    expect(res.body.eggs).toBeGreaterThanOrEqual(120);
    expect(res.body.dozens).toBeGreaterThanOrEqual(10);
    expect(res.body.poultryFeedSpend).toBeGreaterThanOrEqual(10);
    expect(typeof res.body.costPerDozen).toBe("number");
    expect(typeof res.body.costPerEgg).toBe("number");
    expect(typeof res.body.cheaperThanStore).toBe("boolean");
  });

  test("storePricePerDozen query param overrides the env default", async () => {
    const res = await request(
      "GET",
      `/stats/egg-cost?period=${PERIOD}&storePricePerDozen=9.5`,
    );
    expect(res.status).toBe(200);
    expect(res.body.storePricePerDozen).toBe(9.5);
  });
});

describe("GET /stats/summary includes egg analytics", () => {
  test("summary carries eggs + eggCost blocks", async () => {
    const res = await request("GET", "/stats/summary");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("eggs");
    expect(res.body.eggs).toHaveProperty("thisWeek");
    expect(res.body.eggs).toHaveProperty("thisMonth");
    expect(res.body).toHaveProperty("eggCost");
    expect(res.body.eggCost).toHaveProperty("costPerDozenThisMonth");
    expect(res.body.eggCost).toHaveProperty("cheaperThanStore");
  });
});
