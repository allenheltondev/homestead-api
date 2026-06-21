import { request } from "./client.mjs";
import { track, cleanup, ns } from "./_helpers.mjs";

// Runs ONLY via `npm run test:integration` against a deployed staging
// stack (STAGE_API_URL). Excluded from `npm test` (jest.config roots at
// tests/unit). Every created resource is track()ed for DELETE cleanup.

afterEach(cleanup);
afterAll(cleanup);

describe("pasture lifecycle", () => {
  test("create -> get -> list -> delete", async () => {
    const name = ns("pasture");

    const created = await request("POST", "/pastures", { name, acreage: 7.5, notes: "north" });
    expect(created.status).toBe(201);
    const id = created.body?.id;
    expect(id).toBeTruthy();
    track(`/pastures/${id}`);
    expect(created.body).toMatchObject({ name, acreage: 7.5, notes: "north" });

    const fetched = await request("GET", `/pastures/${id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({ id, name });

    const listed = await request("GET", "/pastures");
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body?.pastures)).toBe(true);
    expect(listed.body.pastures.some((p) => p.id === id)).toBe(true);

    const deleted = await request("DELETE", `/pastures/${id}`);
    expect(deleted.status).toBe(204);

    const gone = await request("GET", `/pastures/${id}`);
    expect(gone.status).toBe(404);
  });

  test("rejects a pasture with no name", async () => {
    const res = await request("POST", "/pastures", { acreage: 1 });
    expect(res.status).toBe(400);
  });

  test("occupancy of an empty pasture is an empty list", async () => {
    const name = ns("pasture");
    const created = await request("POST", "/pastures", { name });
    const id = created.body?.id;
    track(`/pastures/${id}`);

    const occupancy = await request("GET", `/pastures/${id}/animals`);
    expect(occupancy.status).toBe(200);
    expect(occupancy.body).toMatchObject({ pastureId: id });
    expect(Array.isArray(occupancy.body.animals)).toBe(true);
  });
});
