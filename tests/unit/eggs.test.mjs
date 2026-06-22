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
  createEggCollection,
  listEggCollections,
  deleteEggCollection,
  monthsInRange,
} = await import("../../api/domain/eggs.mjs");
const {
  validateEggCollectionCreate,
  validateEggCollectionQuery,
} = await import("../../api/validation/eggs.mjs");
const { registerEggRoutes } = await import("../../api/routes/eggs.mjs");

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

describe("validateEggCollectionCreate", () => {
  test("accepts a count + explicit date and normalizes to ISO midnight", () => {
    const fields = validateEggCollectionCreate({ count: 12, date: "2026-06-15", coop: " Barn " });
    expect(fields.count).toBe(12);
    expect(fields.collectedAt).toBe("2026-06-15T00:00:00.000Z");
    expect(fields.coop).toBe("Barn");
  });

  test("defaults date to today (UTC midnight) when omitted", () => {
    const fields = validateEggCollectionCreate({ count: 3 });
    const today = new Date().toISOString().slice(0, 10);
    expect(fields.collectedAt).toBe(`${today}T00:00:00.000Z`);
    expect(fields.coop).toBeUndefined();
  });

  test("rejects a non-integer or < 1 count", () => {
    expect(() => validateEggCollectionCreate({ count: 0 })).toThrow(/count/i);
    expect(() => validateEggCollectionCreate({ count: 2.5 })).toThrow(/count/i);
    expect(() => validateEggCollectionCreate({ count: "x" })).toThrow(/count/i);
  });

  test("rejects a malformed date", () => {
    expect(() => validateEggCollectionCreate({ count: 1, date: "nope" })).toThrow(/date/i);
  });

  test("defaults birdType to chicken and accepts a valid override", () => {
    expect(validateEggCollectionCreate({ count: 1 }).birdType).toBe("chicken");
    expect(validateEggCollectionCreate({ count: 1, birdType: "Duck" }).birdType).toBe("duck");
  });

  test("rejects an unknown birdType", () => {
    expect(() => validateEggCollectionCreate({ count: 1, birdType: "emu" })).toThrow(/birdType/i);
  });
});

describe("validateEggCollectionQuery", () => {
  test("parses from/to bounds, making to inclusive of the month", () => {
    const { fromTs, toTs } = validateEggCollectionQuery({ from: "2026-06", to: "2026-06" });
    expect(fromTs).toBe("2026-06-01T00:00:00.000Z");
    expect(toTs).toBe("2026-06-30T23:59:59.999Z");
  });

  test("rejects an inverted range", () => {
    expect(() => validateEggCollectionQuery({ from: "2026-06", to: "2026-05" })).toThrow(/before/i);
  });
});

describe("createEggCollection", () => {
  test("writes the row with correct keys + an id pointer", async () => {
    send.mockResolvedValueOnce({});

    const item = await createEggCollection({
      count: 12,
      collectedAt: "2026-06-15T00:00:00.000Z",
      coop: "Barn",
    });

    expect(item.pk).toBe("EGG#2026-06");
    expect(item.sk).toBe(`COLLECT#2026-06-15T00:00:00.000Z#${item.id}`);
    expect(item.count).toBe(12);
    expect(item.coop).toBe("Barn");

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(TransactWriteCommand);
    const transactItems = cmd.input.TransactItems;
    expect(transactItems).toHaveLength(2);

    const rowPut = transactItems[0].Put.Item;
    expect(rowPut.pk).toBe("EGG#2026-06");

    const pointerPut = transactItems[1].Put.Item;
    expect(pointerPut.pk).toBe(`EGGID#${item.id}`);
    expect(pointerPut.sk).toBe("POINTER");
    expect(pointerPut.targetPk).toBe(item.pk);
    expect(pointerPut.targetSk).toBe(item.sk);
  });

  test("route publishes an EggsCollected event on create", async () => {
    send.mockResolvedValueOnce({});
    publishEvent.mockResolvedValueOnce({});

    const app = fakeApp();
    registerEggRoutes(app);

    const event = {
      body: JSON.stringify({ count: 8, date: "2026-05-01", coop: "Coop A" }),
    };
    const res = await app.routes["POST /egg-collections"]({ event });

    expect(res.statusCode).toBe(201);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    const [detailType, detail] = publishEvent.mock.calls[0];
    expect(detailType).toBe("EggsCollected");
    expect(detail.count).toBe(8);
    expect(detail.coop).toBe("Coop A");
    expect(JSON.parse(res.body).count).toBe(8);
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

describe("listEggCollections", () => {
  test("range fans out one Query per month partition (no Scan)", async () => {
    send.mockResolvedValue({ Items: [] });

    await listEggCollections({
      fromTs: "2026-04-01T00:00:00.000Z",
      toTs: "2026-06-30T23:59:59.999Z",
    });

    expect(send).toHaveBeenCalledTimes(3);
    const pks = send.mock.calls.map((c) => {
      expect(c[0]).toBeInstanceOf(QueryCommand);
      return c[0].input.ExpressionAttributeValues[":pk"];
    });
    expect(pks).toEqual(["EGG#2026-04", "EGG#2026-05", "EGG#2026-06"]);
    expect(send.mock.calls[0][0].input.KeyConditionExpression).toContain("BETWEEN");
  });

  test("results are sorted chronologically", async () => {
    send.mockResolvedValueOnce({
      Items: [
        { collectedAt: "2026-06-20T00:00:00.000Z", count: 1 },
        { collectedAt: "2026-06-01T00:00:00.000Z", count: 1 },
      ],
    });
    const items = await listEggCollections({
      fromTs: "2026-06-01T00:00:00.000Z",
      toTs: "2026-06-30T23:59:59.999Z",
    });
    expect(items.map((i) => i.collectedAt)).toEqual([
      "2026-06-01T00:00:00.000Z",
      "2026-06-20T00:00:00.000Z",
    ]);
  });
});

describe("deleteEggCollection", () => {
  test("resolves the pointer then deletes row + pointer", async () => {
    send
      .mockResolvedValueOnce({
        Item: { targetPk: "EGG#2026-06", targetSk: "COLLECT#2026-06-15T00:00:00.000Z#abc" },
      })
      .mockResolvedValueOnce({});

    await deleteEggCollection("abc");

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(send.mock.calls[0][0].input.Key).toEqual({ pk: "EGGID#abc", sk: "POINTER" });

    const del = send.mock.calls[1][0];
    expect(del).toBeInstanceOf(TransactWriteCommand);
    const keys = del.input.TransactItems.map((t) => t.Delete.Key);
    expect(keys).toContainEqual({ pk: "EGG#2026-06", sk: "COLLECT#2026-06-15T00:00:00.000Z#abc" });
    expect(keys).toContainEqual({ pk: "EGGID#abc", sk: "POINTER" });
  });

  test("throws NotFound when the pointer is missing", async () => {
    send.mockResolvedValueOnce({});
    await expect(deleteEggCollection("missing")).rejects.toThrow(/not found/i);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
