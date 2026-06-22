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

const { PutCommand, QueryCommand, DeleteCommand } = await import("@aws-sdk/lib-dynamodb");
const {
  createBreeding,
  listBreedings,
  listBreedingsDue,
  deleteBreeding,
  computeExpectedDueAt,
  gestationDaysFor,
} = await import("../../api/domain/breeding.mjs");
const { validateBreedingCreate, parseWithinDays } = await import("../../api/validation/breeding.mjs");

beforeEach(() => {
  send.mockReset();
  publishEvent.mockReset();
});

describe("gestation tables", () => {
  test("species map drives expectedDueAt; default 150", () => {
    expect(gestationDaysFor("sheep")).toBe(147);
    expect(gestationDaysFor("pig")).toBe(114);
    expect(gestationDaysFor("unknown")).toBe(150);
    expect(computeExpectedDueAt("pig", "2026-01-01T00:00:00.000Z"))
      .toBe("2026-04-25T00:00:00.000Z");
  });
});

describe("validateBreedingCreate", () => {
  test("requires species + damId; sire optional", () => {
    const fields = validateBreedingCreate({ species: "Goat", damId: "d1", bredAt: "2026-06-01" });
    expect(fields.species).toBe("goat");
    expect(fields.damId).toBe("d1");
    expect(fields.sireId).toBeUndefined();
    expect(fields.bredAt).toBe("2026-06-01T00:00:00.000Z");
  });
  test("rejects unknown species + missing damId", () => {
    expect(() => validateBreedingCreate({ species: "horse", damId: "d" })).toThrow(/species/i);
    expect(() => validateBreedingCreate({ species: "goat" })).toThrow(/damId/i);
  });
});

describe("parseWithinDays", () => {
  test("defaults to 30 and validates range", () => {
    expect(parseWithinDays(undefined)).toBe(30);
    expect(parseWithinDays("10")).toBe(10);
    expect(() => parseWithinDays("0")).toThrow(/withinDays/i);
  });
});

describe("createBreeding", () => {
  test("writes a metadata item with GSI keyed by expectedDueAt", async () => {
    send.mockResolvedValueOnce({});
    const item = await createBreeding({ species: "goat", damId: "d1", bredAt: "2026-06-01T00:00:00.000Z" });
    expect(item.pk).toBe(`BREEDING#${item.id}`);
    expect(item.gsi1pk).toBe("BREEDING");
    expect(item.gsi1sk).toBe(item.expectedDueAt);
    expect(send.mock.calls[0][0]).toBeInstanceOf(PutCommand);
  });
});

describe("listBreedings / listBreedingsDue", () => {
  test("list is a single GSI1 Query", async () => {
    send.mockResolvedValueOnce({ Items: [] });
    await listBreedings();
    expect(send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
    expect(send.mock.calls[0][0].input.ExpressionAttributeValues[":pk"]).toBe("BREEDING");
  });

  test("due is a single GSI1 Query range-bounded on gsi1sk (no Scan)", async () => {
    send.mockResolvedValueOnce({ Items: [] });
    const now = new Date("2026-06-01T00:00:00.000Z");
    await listBreedingsDue(7, now);
    const cmd = send.mock.calls[0][0];
    expect(cmd.input.KeyConditionExpression).toContain("BETWEEN");
    expect(cmd.input.ExpressionAttributeValues[":lo"]).toBe("2026-06-01T00:00:00.000Z");
    expect(cmd.input.ExpressionAttributeValues[":hi"]).toBe("2026-06-08T00:00:00.000Z");
  });
});

describe("deleteBreeding", () => {
  test("conditional delete on metadata key", async () => {
    send.mockResolvedValueOnce({});
    await deleteBreeding("a");
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteCommand);
    expect(send.mock.calls[0][0].input.Key).toEqual({ pk: "BREEDING#a", sk: "METADATA" });
  });
});
