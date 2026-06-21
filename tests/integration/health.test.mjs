import { request } from "./client.mjs";
import { track, cleanup, ns } from "./_helpers.mjs";

// Runs ONLY via `npm run test:integration` against a deployed staging
// stack (STAGE_API_URL). Excluded from `npm test`.

afterEach(cleanup);
afterAll(cleanup);

describe("GET /health", () => {
  test("returns 200 { status: 'ok' }", async () => {
    const { status, body } = await request("GET", "/health");
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });
});

// Placeholder create -> get -> delete pattern. Skipped until a feature
// stream lands a CRUD resource; once `/animals` exists, drop the .skip and
// point the paths at it. Kept here so feature work has a working template
// (track() for cleanup, ns() for namespacing).
describe.skip("resource lifecycle (enable once a CRUD endpoint exists)", () => {
  test("create -> get -> delete", async () => {
    const name = ns("animal");

    const created = await request("POST", "/animals", { name, species: "cattle" });
    expect(created.status).toBe(201);
    const id = created.body?.id;
    track(`/animals/${id}`);

    const fetched = await request("GET", `/animals/${id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({ id, name });

    const deleted = await request("DELETE", `/animals/${id}`);
    expect(deleted.status).toBe(204);
  });
});
