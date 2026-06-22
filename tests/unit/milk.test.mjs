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
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} = await import("@aws-sdk/lib-dynamodb");
const {
  createMilkLog,
  listMilkLogs,
  deleteMilkLog,
} = await import("../../api/domain/milk.mjs");
const {
  validateMilkLogCreate,
  validateMilkLogQuery,
} = await import("../../api/validation/milk.mjs");
const { registerMilkRoutes } = await import("../../api/routes/milk.mjs");

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

describe("validateMilkLogCreate", () => {
  test("accepts volume + date, defaults unit to gallon", () => {
    const fields = validateMilkLogCreate({ volume: 1.5, date: "2026-06-15" });
    expect(fields.volume).toBe(1.5);
    expect(fields.unit).toBe("gallon");
    expect(fields.loggedAt).toBe("2026-06-15T00:00:00.000Z");
  });

  test("accepts an animalId + alternate unit", () => {
    const fields = validateMilkLogCreate({ volume: 2, unit: "quart", animalId: " Bessie " });
    expect(fields.unit).toBe("quart");
    expect(fields.animalId).toBe("Bessie");
  });

  test("rejects a non-positive volume", () => {
    expect(() => validateMilkLogCreate({ volume: 0 })).toThrow(/volume/i);
  });

  test("rejects an unknown unit", () => {
    expect(() => validateMilkLogCreate({ volume: 1, unit: "barrel" })).toThrow(/unit/i);
  });
});

describe("validateMilkLogQuery", () => {
  test("parses from/to bounds, making to inclusive of the month", () => {
    const { fromTs, toTs } = validateMilkLogQuery({ from: "2026-06", to: "2026-06" });
    expect(fromTs).toBe("2026-06-01T00:00:00.000Z");
    expect(toTs).toBe("2026-06-30T23:59:59.999Z");
  });
});

describe("createMilkLog", () => {
  test("writes the row with correct keys + an id pointer", async () => {
    send.mockResolvedValueOnce({});
    const item = await createMilkLog({
      volume: 1,
      unit: "gallon",
      loggedAt: "2026-06-15T00:00:00.000Z",
      animalId: "Bessie",
    });

    expect(item.pk).toBe("MILK#2026-06");
    expect(item.sk).toBe(`LOG#2026-06-15T00:00:00.000Z#${item.id}`);
    expect(item.volume).toBe(1);
    expect(item.animalId).toBe("Bessie");

    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(TransactWriteCommand);
    const pointerPut = cmd.input.TransactItems[1].Put.Item;
    expect(pointerPut.pk).toBe(`MILKID#${item.id}`);
    expect(pointerPut.targetSk).toBe(item.sk);
  });

  test("route publishes a MilkLogged event on create", async () => {
    send.mockResolvedValueOnce({});
    publishEvent.mockResolvedValueOnce({});
    const app = fakeApp();
    registerMilkRoutes(app);

    const event = { body: JSON.stringify({ volume: 2, date: "2026-05-01" }) };
    const res = await app.routes["POST /milk-logs"]({ event });

    expect(res.statusCode).toBe(201);
    const [detailType, detail] = publishEvent.mock.calls[0];
    expect(detailType).toBe("MilkLogged");
    expect(detail.volume).toBe(2);
  });
});

describe("listMilkLogs", () => {
  test("range fans out one Query per month partition (no Scan)", async () => {
    send.mockResolvedValue({ Items: [] });
    await listMilkLogs({
      fromTs: "2026-04-01T00:00:00.000Z",
      toTs: "2026-06-30T23:59:59.999Z",
    });
    expect(send).toHaveBeenCalledTimes(3);
    const pks = send.mock.calls.map((c) => {
      expect(c[0]).toBeInstanceOf(QueryCommand);
      return c[0].input.ExpressionAttributeValues[":pk"];
    });
    expect(pks).toEqual(["MILK#2026-04", "MILK#2026-05", "MILK#2026-06"]);
  });
});

describe("deleteMilkLog", () => {
  test("resolves the pointer then deletes row + pointer", async () => {
    send
      .mockResolvedValueOnce({ Item: { targetPk: "MILK#2026-06", targetSk: "LOG#x#abc" } })
      .mockResolvedValueOnce({});
    await deleteMilkLog("abc");
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    const del = send.mock.calls[1][0];
    const keys = del.input.TransactItems.map((t) => t.Delete.Key);
    expect(keys).toContainEqual({ pk: "MILK#2026-06", sk: "LOG#x#abc" });
    expect(keys).toContainEqual({ pk: "MILKID#abc", sk: "POINTER" });
  });

  test("throws NotFound when the pointer is missing", async () => {
    send.mockResolvedValueOnce({});
    await expect(deleteMilkLog("missing")).rejects.toThrow(/not found/i);
  });
});
