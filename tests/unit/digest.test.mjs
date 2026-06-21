import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";
process.env.EVENT_BUS_NAME = "default";

// Mock the stats domain functions composeWeeklyDigest composes, so the digest
// composition + handler are exercised in isolation (no DDB).
const eggStats = jest.fn();
const feedStats = jest.fn();
const feedInventory = jest.fn();
const birthStats = jest.fn();
const deathStats = jest.fn();
const mortalitySummary = jest.fn();
jest.unstable_mockModule("../../api/domain/stats.mjs", () => ({
  eggStats,
  feedStats,
  feedInventory,
  birthStats,
  deathStats,
  mortalitySummary,
}));

// Mock EventBridge publish + SES send.
const publishEvent = jest.fn();
jest.unstable_mockModule("../../api/services/events.mjs", () => ({ publishEvent }));

const sesSend = jest.fn();
const SendEmailCommand = jest.fn((input) => ({ input }));
jest.unstable_mockModule("@aws-sdk/client-ses", () => ({
  SESClient: jest.fn(() => ({ send: sesSend })),
  SendEmailCommand,
}));

const { composeWeeklyDigest } = await import("../../api/domain/digest.mjs");

function primeStats() {
  eggStats.mockResolvedValue({ totalEggs: 84, dozens: 7, days: 7, perDay: 12 });
  feedStats.mockResolvedValue({ totalCost: 120, totalQuantity: 50, purchaseCount: 2, byType: {} });
  feedInventory.mockResolvedValue({
    feedTypes: [],
    totals: { onHandLbs: 200, daysRemaining: 30, burnRateLbsPerDay: 6.67 },
  });
  birthStats.mockResolvedValue({ type: "birth", months: [], total: 3 });
  deathStats.mockResolvedValue({ type: "death", months: [], total: 1 });
  mortalitySummary.mockResolvedValue({ totalDeaths: 1, lossRate: 0.05, topCause: "predator" });
}

beforeEach(() => {
  eggStats.mockReset();
  feedStats.mockReset();
  feedInventory.mockReset();
  birthStats.mockReset();
  deathStats.mockReset();
  mortalitySummary.mockReset();
  publishEvent.mockReset();
  sesSend.mockReset();
  SendEmailCommand.mockClear();
  delete process.env.DIGEST_SENDER;
  delete process.env.DIGEST_RECIPIENT;
});

describe("composeWeeklyDigest", () => {
  test("composes the digest shape from the stats domain functions", async () => {
    primeStats();
    const digest = await composeWeeklyDigest(new Date("2026-06-21T00:00:00Z"));

    expect(digest.period.to).toBe("2026-06-21T00:00:00.000Z");
    expect(digest.period.from).toBe("2026-06-15T00:00:00.000Z");
    expect(digest.eggs).toEqual({ total: 84, dozens: 7 });
    expect(digest.feedSpend).toBe(120);
    expect(digest.feedOnHandLbs).toBe(200);
    expect(digest.daysRemaining).toBe(30);
    expect(digest.births).toBe(3);
    expect(digest.deaths).toBe(1);
    expect(digest.mortality).toEqual({ lossRate: 0.05, topCause: "predator" });
    expect(Array.isArray(digest.lines)).toBe(true);
    expect(digest.lines.join("\n")).toMatch(/Eggs collected: 84/);
    expect(digest.lines.join("\n")).toMatch(/predator/);
  });
});

describe("digest handler", () => {
  test("always publishes HomesteadDigest and emails when sender + recipient set", async () => {
    primeStats();
    publishEvent.mockResolvedValue({});
    sesSend.mockResolvedValue({});
    process.env.DIGEST_SENDER = "from@example.com";
    process.env.DIGEST_RECIPIENT = "to@example.com";

    const { handler } = await import("../../api/digest.mjs");
    await handler();

    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent.mock.calls[0][0]).toBe("HomesteadDigest");
    expect(sesSend).toHaveBeenCalledTimes(1);
    const sentInput = SendEmailCommand.mock.calls[0][0];
    expect(sentInput.Source).toBe("from@example.com");
    expect(sentInput.Destination.ToAddresses).toEqual(["to@example.com"]);
  });

  test("publishes the event but skips email when not configured", async () => {
    primeStats();
    publishEvent.mockResolvedValue({});

    jest.resetModules();
    const { handler } = await import("../../api/digest.mjs");
    await handler();

    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(sesSend).not.toHaveBeenCalled();
  });

  test("an SES failure never fails the schedule (event already published)", async () => {
    primeStats();
    publishEvent.mockResolvedValue({});
    sesSend.mockRejectedValue(new Error("SES down"));
    process.env.DIGEST_SENDER = "from@example.com";
    process.env.DIGEST_RECIPIENT = "to@example.com";

    jest.resetModules();
    const { handler } = await import("../../api/digest.mjs");
    await expect(handler()).resolves.toBeDefined();
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });
});
