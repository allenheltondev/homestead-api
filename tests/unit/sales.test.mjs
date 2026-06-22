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

const { GetCommand, QueryCommand, TransactWriteCommand } = await import("@aws-sdk/lib-dynamodb");
const { createSale, listSales, deleteSale } = await import("../../api/domain/sales.mjs");
const { validateSaleCreate, validateSaleQuery } = await import("../../api/validation/sales.mjs");
const { registerSalesRoutes } = await import("../../api/routes/sales.mjs");

beforeEach(() => {
  send.mockReset();
  publishEvent.mockReset();
});

function fakeApp() {
  const routes = {};
  const register = (method) => (path, handler) => { routes[`${method} ${path}`] = handler; };
  return { post: register("POST"), get: register("GET"), delete: register("DELETE"), routes };
}

describe("validateSaleCreate", () => {
  test("requires item + amount; quantity optional", () => {
    const fields = validateSaleCreate({ item: " Dozen eggs ", amount: 5, quantity: 3, date: "2026-06-15" });
    expect(fields.item).toBe("Dozen eggs");
    expect(fields.amount).toBe(5);
    expect(fields.quantity).toBe(3);
    expect(fields.soldAt).toBe("2026-06-15T00:00:00.000Z");
  });
  test("rejects negative amount", () => {
    expect(() => validateSaleCreate({ item: "x", amount: -1 })).toThrow(/amount/i);
  });
});

describe("validateSaleQuery", () => {
  test("parses from/to, to inclusive of month", () => {
    const { fromTs, toTs } = validateSaleQuery({ from: "2026-06", to: "2026-06" });
    expect(fromTs).toBe("2026-06-01T00:00:00.000Z");
    expect(toTs).toBe("2026-06-30T23:59:59.999Z");
  });
});

describe("createSale", () => {
  test("writes row with SALE keys + pointer; route publishes SaleRecorded", async () => {
    send.mockResolvedValueOnce({});
    const item = await createSale({ item: "goat", amount: 200, soldAt: "2026-06-15T00:00:00.000Z" });
    expect(item.pk).toBe("SALE#2026-06");
    expect(item.sk).toBe(`SALE#2026-06-15T00:00:00.000Z#${item.id}`);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(TransactWriteCommand);
    expect(cmd.input.TransactItems[1].Put.Item.pk).toBe(`SALEID#${item.id}`);

    send.mockResolvedValueOnce({});
    publishEvent.mockResolvedValueOnce({});
    const app = fakeApp();
    registerSalesRoutes(app);
    const res = await app.routes["POST /sales"]({ event: { body: JSON.stringify({ item: "goat", amount: 200 }) } });
    expect(res.statusCode).toBe(201);
    expect(publishEvent.mock.calls[0][0]).toBe("SaleRecorded");
  });
});

describe("listSales", () => {
  test("range fans out one Query per month (no Scan)", async () => {
    send.mockResolvedValue({ Items: [] });
    await listSales({ fromTs: "2026-05-01T00:00:00.000Z", toTs: "2026-06-30T23:59:59.999Z" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
  });
});

describe("deleteSale", () => {
  test("resolves pointer then deletes both", async () => {
    send
      .mockResolvedValueOnce({ Item: { targetPk: "SALE#2026-06", targetSk: "SALE#x#abc" } })
      .mockResolvedValueOnce({});
    await deleteSale("abc");
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    const keys = send.mock.calls[1][0].input.TransactItems.map((t) => t.Delete.Key);
    expect(keys).toContainEqual({ pk: "SALEID#abc", sk: "POINTER" });
  });
});
