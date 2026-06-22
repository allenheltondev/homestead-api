import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";
process.env.EVENT_BUS_NAME = "default";

const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));

const publishEvent = jest.fn();
jest.unstable_mockModule("../../api/services/events.mjs", () => ({ publishEvent }));

const {
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} = await import("@aws-sdk/lib-dynamodb");
const {
  createIncubationBatch,
  listIncubationBatches,
  recordHatch,
  deleteIncubationBatch,
  computeExpectedHatchAt,
  incubationDaysFor,
} = await import("../../api/domain/incubation.mjs");
const { validateIncubationCreate, validateIncubationHatch } = await import("../../api/validation/incubation.mjs");
const { registerIncubationRoutes } = await import("../../api/routes/incubation.mjs");

beforeEach(() => {
  send.mockReset();
  publishEvent.mockReset();
});

function fakeApp() {
  const routes = {};
  const register = (method) => (path, handler) => { routes[`${method} ${path}`] = handler; };
  return {
    post: register("POST"),
    get: register("GET"),
    patch: register("PATCH"),
    delete: register("DELETE"),
    routes,
  };
}

describe("incubation day tables", () => {
  test("species map drives expectedHatchAt; default 21", () => {
    expect(incubationDaysFor("turkey")).toBe(28);
    expect(incubationDaysFor("goose")).toBe(30);
    expect(incubationDaysFor("unknown")).toBe(21);
    expect(computeExpectedHatchAt("chicken", "2026-06-01T00:00:00.000Z"))
      .toBe("2026-06-22T00:00:00.000Z");
  });
});

describe("validateIncubationCreate", () => {
  test("requires a known species and count", () => {
    const fields = validateIncubationCreate({ species: "Duck", count: 6, setAt: "2026-06-01" });
    expect(fields.species).toBe("duck");
    expect(fields.count).toBe(6);
    expect(fields.setAt).toBe("2026-06-01T00:00:00.000Z");
  });
  test("rejects an unknown species", () => {
    expect(() => validateIncubationCreate({ species: "emu", count: 1 })).toThrow(/species/i);
  });
});

describe("validateIncubationHatch", () => {
  test("requires a non-negative integer hatchedCount", () => {
    expect(validateIncubationHatch({ hatchedCount: 5 })).toEqual({ hatchedCount: 5, status: undefined });
    expect(() => validateIncubationHatch({ hatchedCount: -1 })).toThrow(/hatchedCount/i);
  });
});

describe("createIncubationBatch", () => {
  test("writes a metadata item with collection GSI keys + computed hatch date", async () => {
    send.mockResolvedValueOnce({});
    const item = await createIncubationBatch({ species: "turkey", count: 10, setAt: "2026-06-01T00:00:00.000Z" });
    expect(item.pk).toBe(`INCUBATION#${item.id}`);
    expect(item.sk).toBe("METADATA");
    expect(item.gsi1pk).toBe("INCUBATION");
    expect(item.gsi1sk).toBe("2026-06-01T00:00:00.000Z");
    expect(item.expectedHatchAt).toBe("2026-06-29T00:00:00.000Z");
    expect(item.status).toBe("incubating");
    expect(send.mock.calls[0][0]).toBeInstanceOf(PutCommand);
  });

  test("route publishes EggsSet", async () => {
    send.mockResolvedValueOnce({});
    publishEvent.mockResolvedValueOnce({});
    const app = fakeApp();
    registerIncubationRoutes(app);
    const res = await app.routes["POST /incubation-batches"]({
      event: { body: JSON.stringify({ species: "chicken", count: 12, setAt: "2026-06-01" }) },
    });
    expect(res.statusCode).toBe(201);
    expect(publishEvent.mock.calls[0][0]).toBe("EggsSet");
  });
});

describe("listIncubationBatches", () => {
  test("single GSI1 Query (no Scan)", async () => {
    send.mockResolvedValueOnce({ Items: [{ id: "a" }] });
    const items = await listIncubationBatches();
    expect(send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
    expect(send.mock.calls[0][0].input.IndexName).toBe("GSI1");
    expect(send.mock.calls[0][0].input.ExpressionAttributeValues[":pk"]).toBe("INCUBATION");
    expect(items).toHaveLength(1);
  });
});

describe("recordHatch", () => {
  test("updates hatchedCount + status and publishes Hatched via route", async () => {
    send.mockResolvedValueOnce({ Attributes: { id: "a", species: "duck", count: 6, hatchedCount: 5, status: "hatched" } });
    publishEvent.mockResolvedValueOnce({});
    const app = fakeApp();
    registerIncubationRoutes(app);
    const res = await app.routes["PATCH /incubation-batches/:id"]({
      event: { body: JSON.stringify({ hatchedCount: 5 }) },
      params: { id: "a" },
    });
    expect(res.statusCode).toBe(200);
    expect(send.mock.calls[0][0]).toBeInstanceOf(UpdateCommand);
    expect(publishEvent.mock.calls[0][0]).toBe("Hatched");
  });

  test("direct recordHatch sets default status hatched", async () => {
    send.mockResolvedValueOnce({ Attributes: { status: "hatched" } });
    const out = await recordHatch("a", { hatchedCount: 3 });
    expect(send.mock.calls[0][0].input.ExpressionAttributeValues[":status"]).toBe("hatched");
    expect(out.status).toBe("hatched");
  });
});

describe("deleteIncubationBatch", () => {
  test("conditional delete on the metadata key", async () => {
    send.mockResolvedValueOnce({});
    await deleteIncubationBatch("a");
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(DeleteCommand);
    expect(cmd.input.Key).toEqual({ pk: "INCUBATION#a", sk: "METADATA" });
  });
});
