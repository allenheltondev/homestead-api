import { request } from "./client.mjs";
import { track, cleanup, ns } from "./_helpers.mjs";

// Runs ONLY via `npm run test:integration` against a deployed staging stack
// (STAGE_API_URL). Excluded from `npm test` (jest.config roots at tests/unit).
//
// Egg collections don't carry a free-form label we can namespace, so this
// suite seeds rows in a distinct, far-past month bucket and asserts only on
// the ids it created. Everything is track()ed for DELETE cleanup.

afterEach(cleanup);
afterAll(cleanup);

async function createCollection(overrides = {}) {
  const body = {
    count: 12,
    date: "2026-03-15",
    coop: ns("coop"),
    ...overrides,
  };
  const created = await request("POST", "/egg-collections", body);
  expect(created.status).toBe(201);
  const id = created.body?.id;
  expect(id).toBeTruthy();
  track(`/egg-collections/${id}`);
  return created.body;
}

describe("egg collections", () => {
  test("create -> range query -> delete", async () => {
    const march = await createCollection({ count: 9, date: "2026-03-10" });
    const may = await createCollection({ count: 14, date: "2026-05-20" });

    // Range spanning both months returns both.
    const ranged = await request("GET", "/egg-collections?from=2026-03&to=2026-05");
    expect(ranged.status).toBe(200);
    const rangedIds = (ranged.body?.egg_collections ?? []).map((c) => c.id);
    expect(rangedIds).toEqual(expect.arrayContaining([march.id, may.id]));

    // Narrower range excludes May.
    const marchOnly = await request("GET", "/egg-collections?from=2026-03&to=2026-03");
    expect(marchOnly.status).toBe(200);
    const marchIds = (marchOnly.body?.egg_collections ?? []).map((c) => c.id);
    expect(marchIds).toContain(march.id);
    expect(marchIds).not.toContain(may.id);

    // Delete one explicitly and confirm 204 (cleanup() handles the rest).
    const deleted = await request("DELETE", `/egg-collections/${march.id}`);
    expect(deleted.status).toBe(204);
  });

  test("count defaults the date to today and validates inputs", async () => {
    const created = await request("POST", "/egg-collections", { count: 5 });
    expect(created.status).toBe(201);
    const id = created.body?.id;
    if (id) track(`/egg-collections/${id}`);
    expect(created.body.count).toBe(5);
    expect(typeof created.body.collectedAt).toBe("string");

    const bad = await request("POST", "/egg-collections", { count: 0 });
    expect(bad.status).toBe(400);
  });
});
