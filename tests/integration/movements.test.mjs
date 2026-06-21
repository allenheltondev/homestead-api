import { request } from "./client.mjs";
import { track, cleanup, ns } from "./_helpers.mjs";

// Runs ONLY via `npm run test:integration` against a deployed staging
// stack (STAGE_API_URL). Excluded from `npm test`. Created resources are
// track()ed for DELETE cleanup.

afterEach(cleanup);
afterAll(cleanup);

describe("animal movement", () => {
  test("move an animal into a pasture, list moves, see occupancy", async () => {
    const animalId = ns("animal");

    const pasture = await request("POST", "/pastures", { name: ns("pasture") });
    expect(pasture.status).toBe(201);
    const pastureId = pasture.body?.id;
    track(`/pastures/${pastureId}`);

    const ts = new Date().toISOString();
    const moved = await request("POST", `/animals/${animalId}/moves`, {
      toPastureId: pastureId,
      ts,
      notes: "first placement",
    });
    expect(moved.status).toBe(201);
    expect(moved.body).toMatchObject({ animalId, toPastureId: pastureId, ts });
    track(`/animals/${animalId}/moves/${encodeURIComponent(ts)}`);

    const moves = await request("GET", `/animals/${animalId}/moves`);
    expect(moves.status).toBe(200);
    expect(moves.body.moves.some((m) => m.toPastureId === pastureId)).toBe(true);

    const occupancy = await request("GET", `/pastures/${pastureId}/animals`);
    expect(occupancy.status).toBe(200);
    expect(occupancy.body.animals.some((a) => a.animalId === animalId)).toBe(true);
  });

  test("returns 404 when the target pasture does not exist", async () => {
    const animalId = ns("animal");
    const res = await request("POST", `/animals/${animalId}/moves`, {
      toPastureId: "itest-nonexistent-pasture",
    });
    expect(res.status).toBe(404);
  });

  test("rejects a move with no target pasture", async () => {
    const animalId = ns("animal");
    const res = await request("POST", `/animals/${animalId}/moves`, { notes: "x" });
    expect(res.status).toBe(400);
  });
});
