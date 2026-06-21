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
  createFeedPurchase,
  listFeedPurchases,
  deleteFeedPurchase,
  monthsInRange,
} = await import("../../api/domain/feed.mjs");
const {
  validateFeedPurchaseCreate,
  formatFeedPurchase,
  isPoultryType,
} = await import("../../api/validation/feed.mjs");
const { registerFeedRoutes } = await import("../../api/routes/feed.mjs");

beforeEach(() => {
  send.mockReset();
  publishEvent.mockReset();
});

// Builds a fake Powertools Router that captures registered handlers so we
// can drive route handlers directly (validate -> domain -> format -> event).
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

describe("createFeedPurchase", () => {
  test("writes the row with correct keys + an id pointer", async () => {
    send.mockResolvedValueOnce({});

    const item = await createFeedPurchase({
      type: "hay",
      quantity: 10,
      unit: "bale",
      cost: 120,
      vendor: "Acme Feed",
      purchasedAt: "2026-06-15T12:00:00.000Z",
    });

    expect(item.pk).toBe("FEED#2026-06");
    expect(item.sk).toBe(`PURCHASE#2026-06-15T12:00:00.000Z#${item.id}`);
    expect(item.gsi1pk).toBe("FEED#hay");
    expect(item.gsi1sk).toBe("2026-06-15T12:00:00.000Z");
    expect(item.type).toBe("hay");

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(TransactWriteCommand);
    const transactItems = cmd.input.TransactItems;
    expect(transactItems).toHaveLength(2);

    const rowPut = transactItems[0].Put.Item;
    expect(rowPut.pk).toBe("FEED#2026-06");

    const pointerPut = transactItems[1].Put.Item;
    expect(pointerPut.pk).toBe(`FEEDID#${item.id}`);
    expect(pointerPut.sk).toBe("POINTER");
    expect(pointerPut.targetPk).toBe(item.pk);
    expect(pointerPut.targetSk).toBe(item.sk);
  });

  test("route publishes a FeedPurchased event on create", async () => {
    send.mockResolvedValueOnce({});
    publishEvent.mockResolvedValueOnce({});

    const app = fakeApp();
    registerFeedRoutes(app);

    const event = {
      body: JSON.stringify({
        type: "Grain",
        quantity: 5,
        unit: "bag",
        cost: 60,
        vendor: "Co-op",
        purchasedAt: "2026-05-01T00:00:00.000Z",
      }),
    };
    const res = await app.routes["POST /feed-purchases"]({ event });

    expect(res.statusCode).toBe(201);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    const [detailType, detail] = publishEvent.mock.calls[0];
    expect(detailType).toBe("FeedPurchased");
    expect(detail.type).toBe("grain"); // normalized lower-case
    expect(detail.vendor).toBe("Co-op");
    expect(JSON.parse(res.body).type).toBe("grain");
  });
});

describe("feed-by-the-bag validation", () => {
  test("accepts the bag shape and derives totalLbs", () => {
    const fields = validateFeedPurchaseCreate({
      bags: 4,
      bagWeightLbs: 50,
      feedType: "Layer",
      cost: 80,
      date: "2026-06-10",
    });
    expect(fields.bags).toBe(4);
    expect(fields.bagWeightLbs).toBe(50);
    expect(fields.totalLbs).toBe(200);
    // chicken/layer/poultry collapse to poultry.
    expect(fields.type).toBe("poultry");
    expect(fields.feedType).toBe("poultry");
    expect(fields.cost).toBe(80);
    expect(fields.purchasedAt).toBe("2026-06-10T00:00:00.000Z");
  });

  test("cost defaults to 0 when omitted on a bag purchase", () => {
    const fields = validateFeedPurchaseCreate({
      bags: 1,
      bagWeightLbs: 40,
      feedType: "chicken",
    });
    expect(fields.cost).toBe(0);
    expect(fields.type).toBe("poultry");
  });

  test("rejects bad bag fields", () => {
    expect(() => validateFeedPurchaseCreate({ bags: 0, bagWeightLbs: 50, feedType: "layer" }))
      .toThrow(/bags/i);
    expect(() => validateFeedPurchaseCreate({ bags: 2, bagWeightLbs: 0, feedType: "layer" }))
      .toThrow(/bagWeightLbs/i);
  });

  test("legacy quantity/unit shape still works", () => {
    const fields = validateFeedPurchaseCreate({
      type: "hay",
      quantity: 10,
      unit: "bale",
      cost: 120,
      vendor: "Acme",
    });
    expect(fields.quantity).toBe(10);
    expect(fields.unit).toBe("bale");
    expect(fields.bags).toBeUndefined();
    expect(fields.type).toBe("hay");
  });

  test("isPoultryType classifies chicken/layer/poultry", () => {
    expect(isPoultryType("chicken")).toBe(true);
    expect(isPoultryType("Layer")).toBe(true);
    expect(isPoultryType("poultry")).toBe(true);
    expect(isPoultryType("hay")).toBe(false);
  });

  test("createFeedPurchase stores the bag fields and formatFeedPurchase emits them", async () => {
    send.mockResolvedValueOnce({});
    const fields = validateFeedPurchaseCreate({
      bags: 3,
      bagWeightLbs: 50,
      feedType: "layer",
      cost: 60,
      date: "2026-06-01",
    });
    const item = await createFeedPurchase(fields);
    expect(item.bags).toBe(3);
    expect(item.totalLbs).toBe(150);
    expect(item.type).toBe("poultry");

    const formatted = formatFeedPurchase(item);
    expect(formatted.bags).toBe(3);
    expect(formatted.bagWeightLbs).toBe(50);
    expect(formatted.totalLbs).toBe(150);
    expect(formatted.feedType).toBe("poultry");
    // No legacy-only fields leak in on a bag purchase.
    expect(formatted.quantity).toBeUndefined();
    expect(formatted.vendor).toBeUndefined();
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

describe("listFeedPurchases", () => {
  test("range fans out one Query per month partition (no Scan)", async () => {
    // Three month buckets -> three Query calls, none a Scan.
    send.mockResolvedValue({ Items: [] });

    await listFeedPurchases({
      fromTs: "2026-04-01T00:00:00.000Z",
      toTs: "2026-06-30T23:59:59.999Z",
    });

    expect(send).toHaveBeenCalledTimes(3);
    const pks = send.mock.calls.map((c) => {
      expect(c[0]).toBeInstanceOf(QueryCommand);
      return c[0].input.ExpressionAttributeValues[":pk"];
    });
    expect(pks).toEqual(["FEED#2026-04", "FEED#2026-05", "FEED#2026-06"]);
    // Each query bounds the sort key by ts range.
    expect(send.mock.calls[0][0].input.KeyConditionExpression).toContain("BETWEEN");
  });

  test("type-only filter uses a single GSI1 Query", async () => {
    send.mockResolvedValueOnce({ Items: [{ purchasedAt: "2026-06-01T00:00:00.000Z" }] });

    const items = await listFeedPurchases({ type: "hay" });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(QueryCommand);
    expect(cmd.input.IndexName).toBe("GSI1");
    expect(cmd.input.ExpressionAttributeValues[":pk"]).toBe("FEED#hay");
    expect(items).toHaveLength(1);
  });

  test("results are sorted chronologically", async () => {
    send.mockResolvedValueOnce({
      Items: [
        { purchasedAt: "2026-06-20T00:00:00.000Z" },
        { purchasedAt: "2026-06-01T00:00:00.000Z" },
      ],
    });
    const items = await listFeedPurchases({ type: "hay" });
    expect(items.map((i) => i.purchasedAt)).toEqual([
      "2026-06-01T00:00:00.000Z",
      "2026-06-20T00:00:00.000Z",
    ]);
  });
});

describe("deleteFeedPurchase", () => {
  test("resolves the pointer then deletes row + pointer", async () => {
    send
      .mockResolvedValueOnce({
        Item: { targetPk: "FEED#2026-06", targetSk: "PURCHASE#2026-06-15T12:00:00.000Z#abc" },
      }) // GetCommand pointer lookup
      .mockResolvedValueOnce({}); // TransactWrite delete

    await deleteFeedPurchase("abc");

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(send.mock.calls[0][0].input.Key).toEqual({ pk: "FEEDID#abc", sk: "POINTER" });

    const del = send.mock.calls[1][0];
    expect(del).toBeInstanceOf(TransactWriteCommand);
    const keys = del.input.TransactItems.map((t) => t.Delete.Key);
    expect(keys).toContainEqual({ pk: "FEED#2026-06", sk: "PURCHASE#2026-06-15T12:00:00.000Z#abc" });
    expect(keys).toContainEqual({ pk: "FEEDID#abc", sk: "POINTER" });
  });

  test("throws NotFound when the pointer is missing", async () => {
    send.mockResolvedValueOnce({}); // no Item
    await expect(deleteFeedPurchase("missing")).rejects.toThrow(/not found/i);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
