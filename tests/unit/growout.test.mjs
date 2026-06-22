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

const { PutCommand, QueryCommand, UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
const {
  createGrowout,
  listGrowouts,
  deleteGrowout,
} = await import("../../api/domain/growout.mjs");
const { validateGrowoutCreate, validateGrowoutProcess } = await import("../../api/validation/growout.mjs");
const { registerGrowoutRoutes } = await import("../../api/routes/growout.mjs");

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

describe("validateGrowoutCreate", () => {
  test("requires species, count, purpose", () => {
    const fields = validateGrowoutCreate({ species: "Broiler", count: 50, purpose: "Meat", startedAt: "2026-06-01" });
    expect(fields.species).toBe("broiler");
    expect(fields.purpose).toBe("meat");
    expect(fields.count).toBe(50);
  });
  test("rejects missing purpose", () => {
    expect(() => validateGrowoutCreate({ species: "broiler", count: 1 })).toThrow(/purpose/i);
  });
});

describe("validateGrowoutProcess", () => {
  test("requires dressedWeightLbsTotal, optional processedCount", () => {
    const fields = validateGrowoutProcess({ dressedWeightLbsTotal: 220, processedCount: 48, processedAt: "2026-09-01" });
    expect(fields.dressedWeightLbsTotal).toBe(220);
    expect(fields.processedCount).toBe(48);
    expect(fields.processedAt).toBe("2026-09-01T00:00:00.000Z");
  });
  test("rejects negative weight", () => {
    expect(() => validateGrowoutProcess({ dressedWeightLbsTotal: -1 })).toThrow(/dressedWeightLbsTotal/i);
  });
});

describe("createGrowout", () => {
  test("writes metadata + GSI keyed by startedAt; status raising", async () => {
    send.mockResolvedValueOnce({});
    const item = await createGrowout({ species: "broiler", count: 50, purpose: "meat", startedAt: "2026-06-01T00:00:00.000Z" });
    expect(item.pk).toBe(`GROWOUT#${item.id}`);
    expect(item.gsi1pk).toBe("GROWOUT");
    expect(item.gsi1sk).toBe("2026-06-01T00:00:00.000Z");
    expect(item.status).toBe("raising");
    expect(send.mock.calls[0][0]).toBeInstanceOf(PutCommand);
  });
});

describe("listGrowouts", () => {
  test("single GSI1 Query (no Scan)", async () => {
    send.mockResolvedValueOnce({ Items: [] });
    await listGrowouts();
    expect(send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
    expect(send.mock.calls[0][0].input.ExpressionAttributeValues[":pk"]).toBe("GROWOUT");
  });
});

describe("recordProcessing", () => {
  test("route updates fields + publishes GrowoutProcessed", async () => {
    send.mockResolvedValueOnce({ Attributes: { id: "a", species: "broiler", dressedWeightLbsTotal: 220, processedCount: 48, processedAt: "x", status: "processed" } });
    publishEvent.mockResolvedValueOnce({});
    const app = fakeApp();
    registerGrowoutRoutes(app);
    const res = await app.routes["PATCH /growout/:id/process"]({
      event: { body: JSON.stringify({ dressedWeightLbsTotal: 220, processedCount: 48 }) },
      params: { id: "a" },
    });
    expect(res.statusCode).toBe(200);
    expect(send.mock.calls[0][0]).toBeInstanceOf(UpdateCommand);
    expect(send.mock.calls[0][0].input.ExpressionAttributeValues[":status"]).toBe("processed");
    expect(publishEvent.mock.calls[0][0]).toBe("GrowoutProcessed");
  });
});

describe("deleteGrowout", () => {
  test("not-found maps to 404 when condition fails", async () => {
    const err = new Error("conditional");
    err.name = "ConditionalCheckFailedException";
    send.mockRejectedValueOnce(err);
    await expect(deleteGrowout("missing")).rejects.toThrow(/not found/i);
  });
});
