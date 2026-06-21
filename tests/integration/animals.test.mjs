import { request } from "./client.mjs";
import { track, cleanup, ns } from "./_helpers.mjs";

// Runs ONLY via `npm run test:integration` against a deployed staging stack
// (STAGE_API_URL). Excluded from `npm test` (jest.config.mjs roots at
// tests/unit). Every created animal is registered for DELETE teardown so a
// shared staging table stays clean even if an assertion fails mid-test.

afterEach(cleanup);
afterAll(cleanup);

describe("animals lifecycle", () => {
  test("create -> get -> list -> patch -> delete", async () => {
    const name = ns("animal");

    const created = await request("POST", "/animals", {
      species: "cattle",
      name,
      sex: "female",
      dob: "2025-04-01",
    });
    expect(created.status).toBe(201);
    const id = created.body?.id;
    expect(id).toBeTruthy();
    track(`/animals/${id}`);
    expect(created.body.status).toBe("active");

    const fetched = await request("GET", `/animals/${id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({ id, name, species: "cattle" });

    const bySpecies = await request("GET", "/animals?species=cattle");
    expect(bySpecies.status).toBe(200);
    expect(bySpecies.body.animals.some((a) => a.id === id)).toBe(true);

    const byStatus = await request("GET", "/animals?status=active");
    expect(byStatus.status).toBe(200);
    expect(byStatus.body.animals.some((a) => a.id === id)).toBe(true);

    const patched = await request("PATCH", `/animals/${id}`, { name: `${name}-renamed` });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe(`${name}-renamed`);

    const deleted = await request("DELETE", `/animals/${id}`);
    expect(deleted.status).toBe(204);

    const gone = await request("GET", `/animals/${id}`);
    expect(gone.status).toBe(404);
  });

  test("birth creates an animal and a BIRTH event", async () => {
    const name = ns("calf");

    const born = await request("POST", "/births", {
      species: "cattle",
      name,
      sex: "male",
      dob: "2026-05-15",
    });
    expect(born.status).toBe(201);
    const id = born.body?.animal?.id;
    expect(id).toBeTruthy();
    track(`/animals/${id}`);
    expect(born.body.event.type).toBe("BIRTH");

    const events = await request("GET", `/animals/${id}/events`);
    expect(events.status).toBe(200);
    expect(events.body.events.some((e) => e.type === "BIRTH")).toBe(true);
  });

  test("death transitions status and conflicts on a second attempt", async () => {
    const name = ns("animal");

    const created = await request("POST", "/animals", { species: "sheep", name });
    expect(created.status).toBe(201);
    const id = created.body?.id;
    track(`/animals/${id}`);

    const death = await request("POST", `/animals/${id}/death`, {
      date: "2026-06-10",
      cause: "predation",
    });
    expect(death.status).toBe(200);
    expect(death.body.animal.status).toBe("deceased");

    const fetched = await request("GET", `/animals/${id}`);
    expect(fetched.body.status).toBe("deceased");

    // A death on a non-active animal is a conflict.
    const again = await request("POST", `/animals/${id}/death`, { date: "2026-06-11" });
    expect(again.status).toBe(409);
  });
});
