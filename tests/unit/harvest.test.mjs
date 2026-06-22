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
  UpdateCommand,
} = await import("@aws-sdk/lib-dynamodb");
const {
  createHarvestLog,
  listHarvestLogs,
  getHarvestLog,
  deleteHarvestLog,
  updateHarvestGrnFields,
  listLinkedHarvestLogs,
  monthsInRange,
} = await import("../../api/domain/harvest.mjs");
const {
  validateHarvestLogCreate,
  validateHarvestLogQuery,
  formatHarvestLog,
} = await import("../../api/validation/harvest.mjs");
const { registerHarvestRoutes } = await import("../../api/routes/harvest.mjs");

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
    delete: register("DELETE"),
    routes,
  };
}

describe("validateHarvestLogCreate", () => {
  test("requires positive quantity + cropName; defaults unit lb, surplus false", () => {
    const fields = validateHarvestLogCreate({ cropName: "Tomato", quantity: 3 });
    expect(fields.unit).toBe("lb");
    expect(fields.surplus).toBe(false);
    const today = new Date().toISOString().slice(0, 10);
    expect(fields.harvestedAt).toBe(`${today}T00:00:00.000Z`);
  });
  test("rejects bad unit + non-positive quantity", () => {
    expect(() => validateHarvestLogCreate({ cropName: "x", quantity: 1, unit: "kg" })).toThrow(/unit/i);
    expect(() => validateHarvestLogCreate({ cropName: "x", quantity: 0 })).toThrow(/quantity/i);
  });
});

describe("validateHarvestLogQuery", () => {
  test("makes to inclusive of the month", () => {
    const { fromTs, toTs } = validateHarvestLogQuery({ from: "2026-06", to: "2026-06" });
    expect(fromTs).toBe("2026-06-01T00:00:00.000Z");
    expect(toTs).toBe("2026-06-30T23:59:59.999Z");
  });
});

describe("createHarvestLog", () => {
  test("writes HARVEST#<month>/LOG# row + id pointer atomically", async () => {
    send.mockResolvedValueOnce({});
    const item = await createHarvestLog({
      cropName: "Tomato", quantity: 5, unit: "lb",
      harvestedAt: "2026-06-15T00:00:00.000Z", surplus: true,
    });
    expect(item.pk).toBe("HARVEST#2026-06");
    expect(item.sk).toBe(`LOG#2026-06-15T00:00:00.000Z#${item.id}`);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(TransactWriteCommand);
    const pointer = cmd.input.TransactItems[1].Put.Item;
    expect(pointer.pk).toBe(`HARVESTID#${item.id}`);
    expect(pointer.targetSk).toBe(item.sk);
  });
});

describe("listHarvestLogs", () => {
  test("range fans out one Query per month (no Scan), sorted", async () => {
    send.mockResolvedValue({ Items: [] });
    await listHarvestLogs({
      fromTs: "2026-04-01T00:00:00.000Z",
      toTs: "2026-06-30T23:59:59.999Z",
    });
    expect(send).toHaveBeenCalledTimes(3);
    const pks = send.mock.calls.map((c) => {
      expect(c[0]).toBeInstanceOf(QueryCommand);
      return c[0].input.ExpressionAttributeValues[":pk"];
    });
    expect(pks).toEqual(["HARVEST#2026-04", "HARVEST#2026-05", "HARVEST#2026-06"]);
  });
});

describe("getHarvestLog", () => {
  test("resolves via pointer then the row", async () => {
    send
      .mockResolvedValueOnce({ Item: { targetPk: "HARVEST#2026-06", targetSk: "LOG#t#a" } })
      .mockResolvedValueOnce({ Item: { id: "a", cropName: "Tomato" } });
    const item = await getHarvestLog("a");
    expect(item.cropName).toBe("Tomato");
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
  });
  test("throws NotFound when the pointer is missing", async () => {
    send.mockResolvedValueOnce({});
    await expect(getHarvestLog("x")).rejects.toThrow(/not found/i);
  });
});

describe("updateHarvestGrnFields", () => {
  test("SETs grn fields and supports REMOVE via null", async () => {
    send
      .mockResolvedValueOnce({ Item: { targetPk: "HARVEST#2026-06", targetSk: "LOG#t#a" } })
      .mockResolvedValueOnce({ Item: { id: "a", pk: "HARVEST#2026-06", sk: "LOG#t#a" } })
      .mockResolvedValueOnce({ Attributes: { id: "a", grnListingId: "L1" } });
    await updateHarvestGrnFields("a", { grnListingId: "L1", grnStatus: "active" });
    const cmd = send.mock.calls[2][0];
    expect(cmd).toBeInstanceOf(UpdateCommand);
    expect(cmd.input.UpdateExpression).toContain("SET");

    send.mockReset();
    send
      .mockResolvedValueOnce({ Item: { targetPk: "HARVEST#2026-06", targetSk: "LOG#t#a" } })
      .mockResolvedValueOnce({ Item: { id: "a", pk: "HARVEST#2026-06", sk: "LOG#t#a" } })
      .mockResolvedValueOnce({ Attributes: { id: "a" } });
    await updateHarvestGrnFields("a", { grnListingId: null, grnStatus: null });
    const cmd2 = send.mock.calls[2][0];
    expect(cmd2.input.UpdateExpression).toContain("REMOVE");
  });
});

describe("listLinkedHarvestLogs", () => {
  test("keeps only logs with a grnListingId", async () => {
    send.mockResolvedValue({
      Items: [
        { id: "1", harvestedAt: "2026-06-01T00:00:00.000Z", grnListingId: "L1" },
        { id: "2", harvestedAt: "2026-06-02T00:00:00.000Z" },
      ],
    });
    const linked = await listLinkedHarvestLogs({
      fromTs: "2026-06-01T00:00:00.000Z",
      toTs: "2026-06-30T23:59:59.999Z",
    });
    expect(linked.map((l) => l.id)).toEqual(["1"]);
  });
});

describe("harvest routes", () => {
  test("POST publishes HarvestLogged", async () => {
    send.mockResolvedValueOnce({});
    publishEvent.mockResolvedValueOnce({});
    const app = fakeApp();
    registerHarvestRoutes(app);
    const event = { body: JSON.stringify({ cropName: "Tomato", quantity: 3, date: "2026-06-01" }) };
    const res = await app.routes["POST /harvest-logs"]({ event });
    expect(res.statusCode).toBe(201);
    expect(publishEvent.mock.calls[0][0]).toBe("HarvestLogged");
  });
});

describe("monthsInRange", () => {
  test("enumerates the month buckets in the window", () => {
    expect(monthsInRange("2026-04-10T00:00:00.000Z", "2026-06-20T00:00:00.000Z"))
      .toEqual(["2026-04", "2026-05", "2026-06"]);
  });
});

describe("deleteHarvestLog + formatHarvestLog", () => {
  test("delete resolves pointer then deletes row + pointer", async () => {
    send
      .mockResolvedValueOnce({ Item: { targetPk: "HARVEST#2026-06", targetSk: "LOG#t#a" } })
      .mockResolvedValueOnce({});
    await deleteHarvestLog("a");
    expect(send.mock.calls[1][0]).toBeInstanceOf(TransactWriteCommand);
  });
  test("format surfaces grn fields as null when unset", () => {
    const out = formatHarvestLog({
      id: "a", cropName: "x", quantity: 1, unit: "lb", harvestedAt: "t", createdAt: "c",
    });
    expect(out.grnListingId).toBeNull();
    expect(out.grnStatus).toBeNull();
    expect(out.cropLibraryId).toBeNull();
    expect(out.grnBedId).toBeNull();
    expect(out.surplus).toBe(false);
  });

  test("validate accepts optional cropLibraryId + grnBedId", () => {
    const fields = validateHarvestLogCreate({
      cropName: "Tomato", quantity: 3, cropLibraryId: "gc-1", grnBedId: "bed-1",
    });
    expect(fields.cropLibraryId).toBe("gc-1");
    expect(fields.grnBedId).toBe("bed-1");
  });
});
