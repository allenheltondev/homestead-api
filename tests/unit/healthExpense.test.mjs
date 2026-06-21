import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";
process.env.EVENT_BUS_NAME = "default";

const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));

const publishEvent = jest.fn();
jest.unstable_mockModule("../../api/services/events.mjs", () => ({
  publishEvent,
}));

const {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} = await import("@aws-sdk/lib-dynamodb");
const {
  createHealthExpense,
  listHealthExpenses,
  deleteHealthExpense,
  monthsInRange,
} = await import("../../api/domain/healthExpense.mjs");
const {
  validateHealthExpenseCreate,
  validateHealthExpenseQuery,
  formatHealthExpense,
} = await import("../../api/validation/healthExpense.mjs");
const { registerHealthExpenseRoutes } = await import("../../api/routes/healthExpense.mjs");

beforeEach(() => {
  send.mockReset();
  publishEvent.mockReset();
});

function fakeApp() {
  const routes = {};
  const register = (method) => (path, handler) => {
    routes[`${method} ${path}`] = handler;
  };
  return {
    post: register("POST"),
    get: register("GET"),
    delete: register("DELETE"),
    routes,
  };
}

describe("validateHealthExpenseCreate", () => {
  test("normalizes category + incurredAt and carries optional fields", () => {
    const fields = validateHealthExpenseCreate({
      category: "Vaccine",
      cost: 12.5,
      animalRef: "01J0",
      note: "annual",
      incurredAt: "2026-06-10",
    });
    expect(fields.category).toBe("vaccine");
    expect(fields.cost).toBe(12.5);
    expect(fields.animalRef).toBe("01J0");
    expect(fields.note).toBe("annual");
    expect(fields.incurredAt).toBe("2026-06-10T00:00:00.000Z");
  });

  test("omits optional fields when absent", () => {
    const fields = validateHealthExpenseCreate({ category: "vet", cost: 0 });
    expect(fields.animalRef).toBeUndefined();
    expect(fields.note).toBeUndefined();
  });

  test("rejects bad payloads", () => {
    expect(() => validateHealthExpenseCreate({ cost: 10 })).toThrow(/category/i);
    expect(() => validateHealthExpenseCreate({ category: "vet" })).toThrow(/cost/i);
    expect(() => validateHealthExpenseCreate({ category: "vet", cost: -1 })).toThrow(/cost/i);
  });
});

describe("validateHealthExpenseQuery", () => {
  test("parses from/to/category bounds with inclusive end", () => {
    const filters = validateHealthExpenseQuery({ from: "2026-06", to: "2026-06", category: "Vet" });
    expect(filters.fromTs).toBe("2026-06-01T00:00:00.000Z");
    expect(filters.toTs).toBe("2026-06-30T23:59:59.999Z");
    expect(filters.category).toBe("vet");
  });

  test("rejects an inverted range", () => {
    expect(() => validateHealthExpenseQuery({ from: "2026-07", to: "2026-06" }))
      .toThrow(/on or before/i);
  });
});

describe("createHealthExpense", () => {
  test("writes the row with correct keys + an id pointer", async () => {
    send.mockResolvedValueOnce({});

    const item = await createHealthExpense({
      category: "vet",
      cost: 100,
      incurredAt: "2026-06-15T12:00:00.000Z",
    });

    expect(item.pk).toBe("HEALTHEXP#2026-06");
    expect(item.sk).toBe(`EXP#2026-06-15T12:00:00.000Z#${item.id}`);
    expect(item.category).toBe("vet");
    expect(item.cost).toBe(100);
    expect(item.entity).toBe("HealthExpense");

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(TransactWriteCommand);
    const transactItems = cmd.input.TransactItems;
    expect(transactItems).toHaveLength(2);

    const pointerPut = transactItems[1].Put.Item;
    expect(pointerPut.pk).toBe(`HEALTHEXPID#${item.id}`);
    expect(pointerPut.sk).toBe("POINTER");
    expect(pointerPut.targetPk).toBe(item.pk);
    expect(pointerPut.targetSk).toBe(item.sk);
  });

  test("route publishes a HealthExpenseRecorded event on create", async () => {
    send.mockResolvedValueOnce({});
    publishEvent.mockResolvedValueOnce({});

    const app = fakeApp();
    registerHealthExpenseRoutes(app);

    const event = {
      body: JSON.stringify({ category: "Vaccine", cost: 25, incurredAt: "2026-05-01T00:00:00.000Z" }),
    };
    const res = await app.routes["POST /health-expenses"]({ event });

    expect(res.statusCode).toBe(201);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    const [detailType, detail] = publishEvent.mock.calls[0];
    expect(detailType).toBe("HealthExpenseRecorded");
    expect(detail.category).toBe("vaccine");
    expect(detail.cost).toBe(25);
  });
});

describe("monthsInRange", () => {
  test("enumerates every month bucket across a multi-month range", () => {
    const months = monthsInRange(
      "2026-04-10T00:00:00.000Z",
      "2026-06-20T23:59:59.999Z",
    );
    expect(months).toEqual(["2026-04", "2026-05", "2026-06"]);
  });
});

describe("listHealthExpenses", () => {
  test("range fans out one Query per month partition (no Scan)", async () => {
    send.mockResolvedValue({ Items: [] });

    await listHealthExpenses({
      fromTs: "2026-04-01T00:00:00.000Z",
      toTs: "2026-06-30T23:59:59.999Z",
    });

    expect(send).toHaveBeenCalledTimes(3);
    const pks = send.mock.calls.map((c) => {
      expect(c[0]).toBeInstanceOf(QueryCommand);
      return c[0].input.ExpressionAttributeValues[":pk"];
    });
    expect(pks).toEqual(["HEALTHEXP#2026-04", "HEALTHEXP#2026-05", "HEALTHEXP#2026-06"]);
    expect(send.mock.calls[0][0].input.KeyConditionExpression).toContain("BETWEEN");
  });

  test("category filter applies a partition-scoped FilterExpression (no Scan)", async () => {
    send.mockResolvedValue({ Items: [] });

    await listHealthExpenses({
      fromTs: "2026-06-01T00:00:00.000Z",
      toTs: "2026-06-30T23:59:59.999Z",
      category: "vet",
    });

    const cmd = send.mock.calls[0][0];
    expect(cmd.input.FilterExpression).toBe("category = :category");
    expect(cmd.input.ExpressionAttributeValues[":category"]).toBe("vet");
  });

  test("results are sorted chronologically", async () => {
    send.mockResolvedValueOnce({
      Items: [
        { incurredAt: "2026-06-20T00:00:00.000Z", category: "vet", cost: 5 },
        { incurredAt: "2026-06-01T00:00:00.000Z", category: "vet", cost: 3 },
      ],
    });
    const items = await listHealthExpenses({
      fromTs: "2026-06-01T00:00:00.000Z",
      toTs: "2026-06-30T23:59:59.999Z",
    });
    expect(items.map((i) => i.incurredAt)).toEqual([
      "2026-06-01T00:00:00.000Z",
      "2026-06-20T00:00:00.000Z",
    ]);
  });
});

describe("deleteHealthExpense", () => {
  test("resolves the pointer then deletes row + pointer", async () => {
    send
      .mockResolvedValueOnce({
        Item: { targetPk: "HEALTHEXP#2026-06", targetSk: "EXP#2026-06-15T12:00:00.000Z#abc" },
      })
      .mockResolvedValueOnce({});

    await deleteHealthExpense("abc");

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(send.mock.calls[0][0].input.Key).toEqual({ pk: "HEALTHEXPID#abc", sk: "POINTER" });

    const del = send.mock.calls[1][0];
    const keys = del.input.TransactItems.map((t) => t.Delete.Key);
    expect(keys).toContainEqual({ pk: "HEALTHEXP#2026-06", sk: "EXP#2026-06-15T12:00:00.000Z#abc" });
    expect(keys).toContainEqual({ pk: "HEALTHEXPID#abc", sk: "POINTER" });
  });

  test("throws NotFound when the pointer is missing", async () => {
    send.mockResolvedValueOnce({});
    await expect(deleteHealthExpense("missing")).rejects.toThrow(/not found/i);
  });
});

describe("formatHealthExpense", () => {
  test("emits the public shape without internal keys; optional fields only when present", () => {
    const out = formatHealthExpense({
      pk: "HEALTHEXP#2026-06",
      sk: "EXP#x#1",
      id: "1",
      category: "vet",
      cost: 5,
      incurredAt: "2026-06-01T00:00:00.000Z",
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    expect(out).toEqual({
      id: "1",
      category: "vet",
      cost: 5,
      incurredAt: "2026-06-01T00:00:00.000Z",
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    expect(out.animalRef).toBeUndefined();
    expect(out.pk).toBeUndefined();
  });
});
