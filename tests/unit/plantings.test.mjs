import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";

const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));

const { PutCommand, QueryCommand, UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
const {
  createPlanting,
  listPlantings,
  updatePlanting,
} = await import("../../api/domain/planting.mjs");
const {
  validatePlantingCreate,
  validatePlantingUpdate,
  validatePlantingQuery,
  formatPlanting,
} = await import("../../api/validation/planting.mjs");

beforeEach(() => send.mockReset());

describe("validatePlantingCreate", () => {
  test("requires cropName, defaults status to growing, normalizes plantedAt", () => {
    const fields = validatePlantingCreate({ cropName: "Tomato", plantedAt: "2026-05-01" });
    expect(fields.cropName).toBe("Tomato");
    expect(fields.status).toBe("growing");
    expect(fields.plantedAt).toBe("2026-05-01T00:00:00.000Z");
  });
  test("rejects an unknown status", () => {
    expect(() => validatePlantingCreate({ cropName: "x", status: "nope" })).toThrow(/status/i);
  });
  test("defaults plantedAt to today when omitted", () => {
    const fields = validatePlantingCreate({ cropName: "x" });
    const today = new Date().toISOString().slice(0, 10);
    expect(fields.plantedAt).toBe(`${today}T00:00:00.000Z`);
  });
});

describe("validatePlantingUpdate", () => {
  test("requires at least one field", () => {
    expect(() => validatePlantingUpdate({})).toThrow(/updatable/i);
  });
  test("normalizes a status change", () => {
    expect(validatePlantingUpdate({ status: "Harvested" })).toEqual({ status: "harvested" });
  });
});

describe("validatePlantingQuery", () => {
  test("rejects an unknown status filter", () => {
    expect(() => validatePlantingQuery({ status: "bad" })).toThrow(/status/i);
  });
  test("returns empty filter when absent", () => {
    expect(validatePlantingQuery({})).toEqual({});
  });
});

describe("createPlanting", () => {
  test("writes PLANTING#<id>/METADATA with a PLANTING collection GSI key", async () => {
    send.mockResolvedValueOnce({});
    const item = await createPlanting({
      cropName: "Kale",
      plantedAt: "2026-04-01T00:00:00.000Z",
      status: "growing",
    });
    expect(item.pk).toBe(`PLANTING#${item.id}`);
    expect(item.gsi1pk).toBe("PLANTING");
    expect(item.gsi1sk).toBe(`2026-04-01T00:00:00.000Z#${item.id}`);
    expect(send.mock.calls[0][0]).toBeInstanceOf(PutCommand);
  });
});

describe("listPlantings", () => {
  test("queries the PLANTING GSI and filters status in code (no Scan)", async () => {
    send.mockResolvedValueOnce({
      Items: [
        { id: "1", status: "growing" },
        { id: "2", status: "harvested" },
      ],
    });
    const items = await listPlantings({ status: "growing" });
    expect(items).toEqual([{ id: "1", status: "growing" }]);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(QueryCommand);
    expect(cmd.input.IndexName).toBe("GSI1");
    expect(cmd.input.ExpressionAttributeValues[":pk"]).toBe("PLANTING");
  });
});

describe("updatePlanting", () => {
  test("rebuilds gsi1sk when plantedAt changes", async () => {
    send
      .mockResolvedValueOnce({ Item: { id: "p1", plantedAt: "2026-01-01T00:00:00.000Z" } })
      .mockResolvedValueOnce({ Attributes: { id: "p1" } });
    await updatePlanting("p1", { plantedAt: "2026-02-01T00:00:00.000Z" });
    const cmd = send.mock.calls[1][0];
    expect(cmd).toBeInstanceOf(UpdateCommand);
    expect(cmd.input.ExpressionAttributeValues[":gsi1sk"]).toBe("2026-02-01T00:00:00.000Z#p1");
  });
});

describe("formatPlanting", () => {
  test("shapes output, null-filling optionals", () => {
    const out = formatPlanting({
      id: "p1", cropName: "Kale", plantedAt: "t", status: "growing", createdAt: "c",
    });
    expect(out.bedId).toBeNull();
    expect(out.expectedHarvestAt).toBeNull();
    expect(out).not.toHaveProperty("pk");
  });
});
