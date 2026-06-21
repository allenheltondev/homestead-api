import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";
process.env.EVENT_BUS_NAME = "default";

// Mock the shared ddb + events services so no AWS call happens. The domain
// layer sends lib-dynamodb command objects through ddb.send; we capture and
// assert on the command class + params.
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
  createFeedConsumption,
  listFeedConsumption,
  deleteFeedConsumption,
  monthsInRange,
} = await import("../../api/domain/feedConsumption.mjs");
const {
  validateFeedConsumptionCreate,
  validateFeedConsumptionQuery,
  formatFeedConsumption,
} = await import("../../api/validation/feedConsumption.mjs");
const { registerFeedConsumptionRoutes } = await import("../../api/routes/feedConsumption.mjs");

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

describe("validateFeedConsumptionCreate", () => {
  test("accepts the lbs shape and normalizes feedType + usedAt", () => {
    const fields = validateFeedConsumptionCreate({
      feedType: "Layer",
      lbs: 25,
      usedAt: "2026-06-10",
    });
    expect(fields.lbs).toBe(25);
    // chicken/layer/poultry collapse to poultry.
    expect(fields.feedType).toBe("poultry");
    expect(fields.usedAt).toBe("2026-06-10T00:00:00.000Z");
  });

  test("accepts the bag shape and derives lbs = bags * bagWeightLbs", () => {
    const fields = validateFeedConsumptionCreate({
      feedType: "hay",
      bags: 3,
      bagWeightLbs: 40,
    });
    expect(fields.lbs).toBe(120);
    expect(fields.feedType).toBe("hay");
  });

  test("rejects bad payloads", () => {
    expect(() => validateFeedConsumptionCreate({ feedType: "hay" }))
      .toThrow(/lbs/i);
    expect(() => validateFeedConsumptionCreate({ feedType: "hay", lbs: 0 }))
      .toThrow(/lbs/i);
    expect(() => validateFeedConsumptionCreate({ feedType: "hay", bags: 0, bagWeightLbs: 50 }))
      .toThrow(/bags/i);
    expect(() => validateFeedConsumptionCreate({ feedType: "hay", bags: 2, bagWeightLbs: 0 }))
      .toThrow(/bagWeightLbs/i);
    expect(() => validateFeedConsumptionCreate({ lbs: 10 }))
      .toThrow(/feedType/i);
  });
});

describe("validateFeedConsumptionQuery", () => {
  test("parses from/to/type bounds with inclusive end", () => {
    const filters = validateFeedConsumptionQuery({ from: "2026-06", to: "2026-06", type: "Layer" });
    expect(filters.fromTs).toBe("2026-06-01T00:00:00.000Z");
    expect(filters.toTs).toBe("2026-06-30T23:59:59.999Z");
    expect(filters.type).toBe("poultry");
  });

  test("rejects an inverted range", () => {
    expect(() => validateFeedConsumptionQuery({ from: "2026-07", to: "2026-06" }))
      .toThrow(/on or before/i);
  });
});

describe("createFeedConsumption", () => {
  test("writes the row with correct keys + an id pointer", async () => {
    send.mockResolvedValueOnce({});

    const item = await createFeedConsumption({
      feedType: "poultry",
      lbs: 25,
      usedAt: "2026-06-15T12:00:00.000Z",
    });

    expect(item.pk).toBe("FEEDUSE#2026-06");
    expect(item.sk).toBe(`USE#2026-06-15T12:00:00.000Z#${item.id}`);
    expect(item.feedType).toBe("poultry");
    expect(item.lbs).toBe(25);
    expect(item.entity).toBe("FeedConsumption");

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(TransactWriteCommand);
    const transactItems = cmd.input.TransactItems;
    expect(transactItems).toHaveLength(2);

    const rowPut = transactItems[0].Put.Item;
    expect(rowPut.pk).toBe("FEEDUSE#2026-06");

    const pointerPut = transactItems[1].Put.Item;
    expect(pointerPut.pk).toBe(`FEEDUSEID#${item.id}`);
    expect(pointerPut.sk).toBe("POINTER");
    expect(pointerPut.targetPk).toBe(item.pk);
    expect(pointerPut.targetSk).toBe(item.sk);
  });

  test("route publishes a FeedConsumed event on create", async () => {
    send.mockResolvedValueOnce({});
    publishEvent.mockResolvedValueOnce({});

    const app = fakeApp();
    registerFeedConsumptionRoutes(app);

    const event = {
      body: JSON.stringify({ feedType: "Chicken", lbs: 10, usedAt: "2026-05-01T00:00:00.000Z" }),
    };
    const res = await app.routes["POST /feed-consumption"]({ event });

    expect(res.statusCode).toBe(201);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    const [detailType, detail] = publishEvent.mock.calls[0];
    expect(detailType).toBe("FeedConsumed");
    expect(detail.feedType).toBe("poultry");
    expect(detail.lbs).toBe(10);
    expect(JSON.parse(res.body).feedType).toBe("poultry");
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

describe("listFeedConsumption", () => {
  test("range fans out one Query per month partition (no Scan)", async () => {
    send.mockResolvedValue({ Items: [] });

    await listFeedConsumption({
      fromTs: "2026-04-01T00:00:00.000Z",
      toTs: "2026-06-30T23:59:59.999Z",
    });

    expect(send).toHaveBeenCalledTimes(3);
    const pks = send.mock.calls.map((c) => {
      expect(c[0]).toBeInstanceOf(QueryCommand);
      return c[0].input.ExpressionAttributeValues[":pk"];
    });
    expect(pks).toEqual(["FEEDUSE#2026-04", "FEEDUSE#2026-05", "FEEDUSE#2026-06"]);
    expect(send.mock.calls[0][0].input.KeyConditionExpression).toContain("BETWEEN");
  });

  test("type filter applies a partition-scoped FilterExpression (no Scan)", async () => {
    send.mockResolvedValue({ Items: [] });

    await listFeedConsumption({
      fromTs: "2026-06-01T00:00:00.000Z",
      toTs: "2026-06-30T23:59:59.999Z",
      type: "poultry",
    });

    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(QueryCommand);
    expect(cmd.input.FilterExpression).toBe("feedType = :type");
    expect(cmd.input.ExpressionAttributeValues[":type"]).toBe("poultry");
  });

  test("results are sorted chronologically", async () => {
    send.mockResolvedValueOnce({
      Items: [
        { usedAt: "2026-06-20T00:00:00.000Z", feedType: "poultry", lbs: 5 },
        { usedAt: "2026-06-01T00:00:00.000Z", feedType: "poultry", lbs: 3 },
      ],
    });
    const items = await listFeedConsumption({
      fromTs: "2026-06-01T00:00:00.000Z",
      toTs: "2026-06-30T23:59:59.999Z",
    });
    expect(items.map((i) => i.usedAt)).toEqual([
      "2026-06-01T00:00:00.000Z",
      "2026-06-20T00:00:00.000Z",
    ]);
  });
});

describe("deleteFeedConsumption", () => {
  test("resolves the pointer then deletes row + pointer", async () => {
    send
      .mockResolvedValueOnce({
        Item: { targetPk: "FEEDUSE#2026-06", targetSk: "USE#2026-06-15T12:00:00.000Z#abc" },
      })
      .mockResolvedValueOnce({});

    await deleteFeedConsumption("abc");

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(send.mock.calls[0][0].input.Key).toEqual({ pk: "FEEDUSEID#abc", sk: "POINTER" });

    const del = send.mock.calls[1][0];
    expect(del).toBeInstanceOf(TransactWriteCommand);
    const keys = del.input.TransactItems.map((t) => t.Delete.Key);
    expect(keys).toContainEqual({ pk: "FEEDUSE#2026-06", sk: "USE#2026-06-15T12:00:00.000Z#abc" });
    expect(keys).toContainEqual({ pk: "FEEDUSEID#abc", sk: "POINTER" });
  });

  test("throws NotFound when the pointer is missing", async () => {
    send.mockResolvedValueOnce({});
    await expect(deleteFeedConsumption("missing")).rejects.toThrow(/not found/i);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("formatFeedConsumption", () => {
  test("emits the public shape without internal keys", () => {
    const out = formatFeedConsumption({
      pk: "FEEDUSE#2026-06",
      sk: "USE#x#1",
      id: "1",
      feedType: "poultry",
      lbs: 5,
      usedAt: "2026-06-01T00:00:00.000Z",
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    expect(out).toEqual({
      id: "1",
      feedType: "poultry",
      lbs: 5,
      usedAt: "2026-06-01T00:00:00.000Z",
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    expect(out.pk).toBeUndefined();
  });
});
