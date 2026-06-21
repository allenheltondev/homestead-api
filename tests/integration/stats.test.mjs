import { request } from "./client.mjs";
import { track, cleanup, ns } from "./_helpers.mjs";

// Runs ONLY via `npm run test:integration` against a deployed staging
// stack (STAGE_API_URL). Excluded from `npm test` (jest.config roots at
// tests/unit).
//
// The stats endpoints are read-only, so to assert real aggregation this
// suite seeds data through the OTHER domains' write endpoints (animals,
// births, deaths, pastures, feed purchases). Those endpoints exist only
// after their streams deploy to staging, so every seeding step is guarded:
// if a write endpoint 404s we skip the assertion that depends on it rather
// than failing the build. Everything created is track()ed for DELETE
// cleanup.

afterEach(cleanup);
afterAll(cleanup);

// POSTs to a write endpoint; returns the response, or null if the endpoint
// isn't deployed yet (404) so callers can skip gracefully.
async function trySeed(path, body) {
  const res = await request("POST", path, body);
  if (res.status === 404) return null;
  return res;
}

describe("GET /stats/* (read-only, always available once stats stream deploys)", () => {
  test("GET /stats/herd returns species/status aggregation shape", async () => {
    const { status, body } = await request("GET", "/stats/herd");
    expect(status).toBe(200);
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("bySpecies");
    expect(body).toHaveProperty("byStatus");
  });

  test("GET /stats/pastures returns occupancy shape", async () => {
    const { status, body } = await request("GET", "/stats/pastures");
    expect(status).toBe(200);
    expect(body).toHaveProperty("total");
    expect(Array.isArray(body.pastures)).toBe(true);
  });

  test("GET /stats/births accepts a period and returns a total", async () => {
    const { status, body } = await request("GET", "/stats/births?period=2026");
    expect(status).toBe(200);
    expect(body).toMatchObject({ type: "birth" });
    expect(typeof body.total).toBe("number");
  });

  test("GET /stats/feed accepts a month period", async () => {
    const { status, body } = await request("GET", "/stats/feed?period=2026-06");
    expect(status).toBe(200);
    expect(body).toHaveProperty("totalCost");
    expect(body).toHaveProperty("byType");
  });

  test("GET /stats/summary returns the speakable composite payload", async () => {
    const { status, body } = await request("GET", "/stats/summary");
    expect(status).toBe(200);
    expect(body).toHaveProperty("herd");
    expect(body).toHaveProperty("births");
    expect(body).toHaveProperty("deaths");
    expect(body).toHaveProperty("feed");
    expect(body).toHaveProperty("pastures");
  });

  test("invalid period is rejected with 400", async () => {
    const { status } = await request("GET", "/stats/births?period=not-a-period");
    expect(status).toBe(400);
  });
});

describe("stats reflect seeded data (skips when a write stream isn't deployed)", () => {
  test("creating an animal increments the herd count", async () => {
    const before = await request("GET", "/stats/herd");
    expect(before.status).toBe(200);

    const res = await trySeed("/animals", { name: ns("animal"), species: "cattle" });
    if (!res) {
      console.warn("POST /animals not deployed yet; skipping herd-delta assertion.");
      return;
    }
    expect([200, 201]).toContain(res.status);
    const id = res.body?.id;
    if (id) track(`/animals/${id}`);

    const after = await request("GET", "/stats/herd");
    expect(after.status).toBe(200);
    expect(after.body.total).toBeGreaterThanOrEqual(before.body.total + 1);
    expect((after.body.bySpecies?.cattle?.total ?? 0)).toBeGreaterThanOrEqual(
      (before.body.bySpecies?.cattle?.total ?? 0) + 1,
    );
  });

  test("recording a birth increments births for the period", async () => {
    const period = String(new Date().getUTCFullYear());
    const before = await request("GET", `/stats/births?period=${period}`);
    expect(before.status).toBe(200);

    const res = await trySeed("/births", { species: "goat", date: new Date().toISOString() });
    if (!res) {
      console.warn("POST /births not deployed yet; skipping birth-delta assertion.");
      return;
    }
    expect([200, 201]).toContain(res.status);
    const id = res.body?.id;
    const animalId = res.body?.animalId;
    if (id && animalId) track(`/animals/${animalId}/events/${id}`);
    else if (animalId) track(`/animals/${animalId}`);

    const after = await request("GET", `/stats/births?period=${period}`);
    expect(after.body.total).toBeGreaterThanOrEqual(before.body.total + 1);
  });

  test("recording a death increments deaths for the period", async () => {
    const period = String(new Date().getUTCFullYear());

    // A death needs an animal to attach to.
    const animal = await trySeed("/animals", { name: ns("animal"), species: "sheep" });
    if (!animal) {
      console.warn("POST /animals not deployed yet; skipping death-delta assertion.");
      return;
    }
    const animalId = animal.body?.id;
    if (animalId) track(`/animals/${animalId}`);

    const before = await request("GET", `/stats/deaths?period=${period}`);
    expect(before.status).toBe(200);

    const death = await trySeed(`/animals/${animalId}/death`, {
      date: new Date().toISOString(),
    });
    if (!death) {
      console.warn("POST /animals/{id}/death not deployed yet; skipping death-delta assertion.");
      return;
    }
    expect([200, 201]).toContain(death.status);

    const after = await request("GET", `/stats/deaths?period=${period}`);
    expect(after.body.total).toBeGreaterThanOrEqual(before.body.total + 1);
  });

  test("creating a pasture shows up in occupancy", async () => {
    const before = await request("GET", "/stats/pastures");
    expect(before.status).toBe(200);

    const res = await trySeed("/pastures", { name: ns("pasture") });
    if (!res) {
      console.warn("POST /pastures not deployed yet; skipping pasture assertion.");
      return;
    }
    expect([200, 201]).toContain(res.status);
    const id = res.body?.id;
    if (id) track(`/pastures/${id}`);

    const after = await request("GET", "/stats/pastures");
    expect(after.body.pastures.length).toBeGreaterThanOrEqual(before.body.pastures.length + 1);
  });

  test("recording a feed purchase increments feed spend for the month", async () => {
    const period = new Date().toISOString().slice(0, 7);
    const before = await request("GET", `/stats/feed?period=${period}`);
    expect(before.status).toBe(200);

    const res = await trySeed("/feed-purchases", {
      type: "hay",
      cost: 42,
      quantity: 3,
      date: new Date().toISOString(),
    });
    if (!res) {
      console.warn("POST /feed-purchases not deployed yet; skipping feed-delta assertion.");
      return;
    }
    expect([200, 201]).toContain(res.status);
    const id = res.body?.id;
    if (id) track(`/feed-purchases/${id}`);

    const after = await request("GET", `/stats/feed?period=${period}`);
    expect(after.body.totalCost).toBeGreaterThanOrEqual(before.body.totalCost + 42);
  });
});
