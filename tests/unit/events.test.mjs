import { jest } from "@jest/globals";

process.env.EVENT_BUS_NAME = "default";

// Mock the EventBridge client so no AWS call happens. send() is asserted
// against to confirm the entry shape (source, detail-type, bus, detail).
const send = jest.fn();
jest.unstable_mockModule("@aws-sdk/client-eventbridge", () => ({
  EventBridgeClient: jest.fn(() => ({ send })),
  PutEventsCommand: jest.fn((input) => ({ input })),
}));

const { publishEvent } = await import("../../api/services/events.mjs");
const { PutEventsCommand } = await import("@aws-sdk/client-eventbridge");

describe("services/events", () => {
  beforeEach(() => {
    send.mockReset();
    PutEventsCommand.mockClear();
  });

  test("publishes an entry on the configured bus with the homestead source", async () => {
    send.mockResolvedValueOnce({ FailedEntryCount: 0, Entries: [{ EventId: "1" }] });

    await publishEvent("AnimalCreated", { id: "a1", species: "cattle" });

    expect(send).toHaveBeenCalledTimes(1);
    const input = PutEventsCommand.mock.calls[0][0];
    const entry = input.Entries[0];
    expect(entry.EventBusName).toBe("default");
    expect(entry.Source).toBe("homestead.api");
    expect(entry.DetailType).toBe("AnimalCreated");
    expect(JSON.parse(entry.Detail)).toEqual({ id: "a1", species: "cattle" });
  });

  test("defaults the detail to an empty object", async () => {
    send.mockResolvedValueOnce({ FailedEntryCount: 0, Entries: [{ EventId: "1" }] });

    await publishEvent("PingHappened");

    const input = PutEventsCommand.mock.calls[0][0];
    expect(JSON.parse(input.Entries[0].Detail)).toEqual({});
  });

  test("throws when EventBridge reports a failed entry", async () => {
    send.mockResolvedValueOnce({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: "InternalException", ErrorMessage: "boom" }],
    });

    await expect(publishEvent("AnimalCreated", { id: "a1" })).rejects.toThrow(/boom/);
  });
});
