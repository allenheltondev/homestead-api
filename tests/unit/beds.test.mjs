import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";

const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));

const {
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} = await import("@aws-sdk/lib-dynamodb");
const {
  createBed,
  getBed,
  listBeds,
  updateBed,
  deleteBed,
  bedExists,
} = await import("../../api/domain/beds.mjs");
const {
  validateBedCreate,
  validateBedUpdate,
  formatBed,
} = await import("../../api/validation/beds.mjs");

beforeEach(() => send.mockReset());

describe("validateBedCreate", () => {
  test("requires a name", () => {
    expect(() => validateBedCreate({})).toThrow(/name/i);
  });
  test("trims name + accepts optional sizeSqFt", () => {
    expect(validateBedCreate({ name: " Row 1 ", sizeSqFt: 32 })).toEqual({
      name: "Row 1",
      sizeSqFt: 32,
    });
  });
  test("rejects a non-positive sizeSqFt", () => {
    expect(() => validateBedCreate({ name: "a", sizeSqFt: 0 })).toThrow(/sizeSqFt/i);
  });
});

describe("validateBedUpdate", () => {
  test("requires at least one field", () => {
    expect(() => validateBedUpdate({})).toThrow(/updatable/i);
  });
  test("returns only supplied fields", () => {
    expect(validateBedUpdate({ name: "New" })).toEqual({ name: "New" });
  });
});

describe("createBed", () => {
  test("writes BED#<id>/METADATA with a BED collection GSI key", async () => {
    send.mockResolvedValueOnce({});
    const item = await createBed({ name: "North Bed", sizeSqFt: 40 });
    expect(item.pk).toBe(`BED#${item.id}`);
    expect(item.sk).toBe("METADATA");
    expect(item.gsi1pk).toBe("BED");
    expect(item.gsi1sk).toBe("North Bed");
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(PutCommand);
    expect(cmd.input.ConditionExpression).toContain("attribute_not_exists");
  });
});

describe("listBeds", () => {
  test("queries GSI1 BED partition, alphabetical (no Scan)", async () => {
    send.mockResolvedValueOnce({ Items: [{ id: "b1", name: "A" }] });
    const { items } = await listBeds();
    expect(items).toHaveLength(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(QueryCommand);
    expect(cmd.input.IndexName).toBe("GSI1");
    expect(cmd.input.ExpressionAttributeValues[":pk"]).toBe("BED");
    expect(cmd.input.ScanIndexForward).toBe(true);
  });
});

describe("updateBed", () => {
  test("rebuilds gsi1sk when name changes", async () => {
    send
      .mockResolvedValueOnce({ Item: { id: "b1", name: "Old", createdAt: "t" } })
      .mockResolvedValueOnce({ Attributes: { id: "b1", name: "New" } });
    await updateBed("b1", { name: "New" });
    const cmd = send.mock.calls[1][0];
    expect(cmd).toBeInstanceOf(UpdateCommand);
    expect(cmd.input.ExpressionAttributeValues[":gsi1sk"]).toBe("New");
  });
});

describe("getBed / bedExists / deleteBed", () => {
  test("getBed throws NotFound when missing", async () => {
    send.mockResolvedValueOnce({});
    await expect(getBed("x")).rejects.toThrow(/not found/i);
  });
  test("bedExists returns boolean without throwing", async () => {
    send.mockResolvedValueOnce({ Item: { pk: "BED#x" } });
    expect(await bedExists("x")).toBe(true);
    send.mockResolvedValueOnce({});
    expect(await bedExists("y")).toBe(false);
  });
  test("deleteBed issues a conditional delete", async () => {
    send.mockResolvedValueOnce({});
    await deleteBed("b1");
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(DeleteCommand);
    expect(cmd.input.ConditionExpression).toContain("attribute_exists");
  });
});

describe("formatBed", () => {
  test("never leaks pk/sk", () => {
    const out = formatBed({ id: "b1", name: "A", pk: "BED#b1", sk: "METADATA", createdAt: "t" });
    expect(out).not.toHaveProperty("pk");
    expect(out.sizeSqFt).toBeNull();
  });
});
