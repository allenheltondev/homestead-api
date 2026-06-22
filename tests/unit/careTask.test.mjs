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

const { PutCommand, QueryCommand, UpdateCommand, GetCommand } = await import("@aws-sdk/lib-dynamodb");
const {
  createCareTask,
  listCareTasks,
  listCareTasksDue,
  completeCareTask,
  computeNextDueAt,
} = await import("../../api/domain/careTask.mjs");
const {
  validateCareTaskCreate,
  validateCareTaskUpdate,
  parseWithinDays,
} = await import("../../api/validation/careTask.mjs");
const { registerCareTaskRoutes } = await import("../../api/routes/careTask.mjs");

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

describe("validateCareTaskCreate", () => {
  test("requires title, category, cadenceDays", () => {
    const fields = validateCareTaskCreate({ title: " Worm goats ", category: "Health", cadenceDays: 90 });
    expect(fields.title).toBe("Worm goats");
    expect(fields.category).toBe("health");
    expect(fields.cadenceDays).toBe(90);
  });
  test("rejects cadenceDays < 1", () => {
    expect(() => validateCareTaskCreate({ title: "t", category: "c", cadenceDays: 0 })).toThrow(/cadenceDays/i);
  });
});

describe("validateCareTaskUpdate", () => {
  test("requires at least one field", () => {
    expect(() => validateCareTaskUpdate({})).toThrow(/at least one/i);
    expect(validateCareTaskUpdate({ cadenceDays: 30 })).toEqual({ cadenceDays: 30 });
  });
});

describe("parseWithinDays", () => {
  test("defaults to 7", () => {
    expect(parseWithinDays(undefined)).toBe(7);
    expect(parseWithinDays("3")).toBe(3);
  });
});

describe("createCareTask", () => {
  test("computes nextDueAt = creation + cadence and keys gsi1sk to it", async () => {
    send.mockResolvedValueOnce({});
    const item = await createCareTask({ title: "t", category: "health", cadenceDays: 30 });
    expect(item.gsi1pk).toBe("CARETASK");
    expect(item.gsi1sk).toBe(item.nextDueAt);
    expect(send.mock.calls[0][0]).toBeInstanceOf(PutCommand);
  });
});

describe("listCareTasks / listCareTasksDue", () => {
  test("list orders soonest-due first via GSI1", async () => {
    send.mockResolvedValueOnce({ Items: [] });
    await listCareTasks();
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(QueryCommand);
    expect(cmd.input.ScanIndexForward).toBe(true);
    expect(cmd.input.ExpressionAttributeValues[":pk"]).toBe("CARETASK");
  });

  test("due is a single GSI1 Query upper-bounded on gsi1sk (no Scan)", async () => {
    send.mockResolvedValueOnce({ Items: [] });
    const now = new Date("2026-06-01T00:00:00.000Z");
    await listCareTasksDue(3, now);
    const cmd = send.mock.calls[0][0];
    expect(cmd.input.KeyConditionExpression).toContain("<=");
    expect(cmd.input.ExpressionAttributeValues[":hi"]).toBe("2026-06-04T00:00:00.000Z");
  });
});

describe("completeCareTask", () => {
  test("reads cadence, sets lastDoneAt, advances nextDueAt + gsi1sk", async () => {
    send
      .mockResolvedValueOnce({ Item: { id: "a", cadenceDays: 30 } })
      .mockResolvedValueOnce({ Attributes: { id: "a", lastDoneAt: "x", nextDueAt: "y" } });
    const now = new Date("2026-06-01T00:00:00.000Z");
    await completeCareTask("a", now);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    const upd = send.mock.calls[1][0];
    expect(upd).toBeInstanceOf(UpdateCommand);
    const expected = computeNextDueAt(now, 30);
    expect(upd.input.ExpressionAttributeValues[":nextDueAt"]).toBe(expected);
    expect(upd.input.ExpressionAttributeValues[":gsi1sk"]).toBe(expected);
    expect(upd.input.ExpressionAttributeValues[":lastDoneAt"]).toBe("2026-06-01T00:00:00.000Z");
  });

  test("route publishes CareTaskCompleted", async () => {
    send
      .mockResolvedValueOnce({ Item: { id: "a", cadenceDays: 30 } })
      .mockResolvedValueOnce({ Attributes: { id: "a", title: "t", lastDoneAt: "x", nextDueAt: "y" } });
    publishEvent.mockResolvedValueOnce({});
    const app = fakeApp();
    registerCareTaskRoutes(app);
    const res = await app.routes["POST /care-tasks/:id/complete"]({ params: { id: "a" } });
    expect(res.statusCode).toBe(200);
    expect(publishEvent.mock.calls[0][0]).toBe("CareTaskCompleted");
  });
});
