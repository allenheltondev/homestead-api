import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";
process.env.EVENT_BUS_NAME = "default";

// Mock the domain functions the alerts handler composes so it is exercised in
// isolation (no DDB).
const feedInventory = jest.fn();
jest.unstable_mockModule("../../api/domain/stats.mjs", () => ({ feedInventory }));

const listCareTasksDue = jest.fn();
jest.unstable_mockModule("../../api/domain/careTask.mjs", () => ({ listCareTasksDue }));

const listBreedingsDue = jest.fn();
jest.unstable_mockModule("../../api/domain/breeding.mjs", () => ({ listBreedingsDue }));

const listIncubationBatches = jest.fn();
jest.unstable_mockModule("../../api/domain/incubation.mjs", () => ({ listIncubationBatches }));

const publishEvent = jest.fn();
jest.unstable_mockModule("../../api/services/events.mjs", () => ({ publishEvent }));

const sesSend = jest.fn();
const SendEmailCommand = jest.fn((input) => ({ input }));
jest.unstable_mockModule("@aws-sdk/client-ses", () => ({
  SESClient: jest.fn(() => ({ send: sesSend })),
  SendEmailCommand,
}));

const { composeAlerts } = await import("../../api/alerts.mjs");

function prime() {
  feedInventory.mockResolvedValue({
    feedTypes: [
      { feedType: "poultry", onHandLbs: 10, daysRemaining: 3, projectedRunOutDate: "2026-06-25" },
      { feedType: "hay", onHandLbs: 1000, daysRemaining: 200, projectedRunOutDate: "2027-01-01" },
      { feedType: "mineral", onHandLbs: 5, daysRemaining: null, projectedRunOutDate: null },
    ],
  });
  listCareTasksDue.mockResolvedValue([
    { id: "t1", title: "Worm goats", category: "health", nextDueAt: "2026-06-23T00:00:00.000Z" },
  ]);
  listBreedingsDue.mockResolvedValue([
    { id: "b1", species: "goat", damId: "d1", expectedDueAt: "2026-06-25T00:00:00.000Z" },
  ]);
  listIncubationBatches.mockResolvedValue([
    { id: "i1", status: "incubating", species: "duck", count: 6, expectedHatchAt: "2026-06-24T00:00:00.000Z" },
    { id: "i2", status: "hatched", species: "chicken", count: 12, expectedHatchAt: "2026-01-01T00:00:00.000Z" },
  ]);
}

beforeEach(() => {
  feedInventory.mockReset();
  listCareTasksDue.mockReset();
  listBreedingsDue.mockReset();
  listIncubationBatches.mockReset();
  publishEvent.mockReset();
  sesSend.mockReset();
  SendEmailCommand.mockClear();
  delete process.env.DIGEST_SENDER;
  delete process.env.DIGEST_RECIPIENT;
  delete process.env.HOMESTEAD_LATITUDE;
  delete process.env.HOMESTEAD_LONGITUDE;
  delete process.env.LOW_FEED_ALERT_DAYS;
  delete globalThis.fetch;
});

describe("composeAlerts", () => {
  test("includes low feed (below threshold only), care, hatches, breedings; skips weather when unset", async () => {
    prime();
    const alerts = await composeAlerts(new Date("2026-06-22T00:00:00.000Z"));

    // Only poultry is below the default 7-day threshold; hay (200) and the
    // null-daysRemaining mineral are excluded.
    expect(alerts.lowFeed.map((f) => f.feedType)).toEqual(["poultry"]);
    expect(alerts.careTasksDue).toHaveLength(1);
    expect(alerts.upcomingHatches).toHaveLength(1);
    expect(alerts.upcomingBreedings).toHaveLength(1);
    expect(alerts.weather).toBeNull();
    expect(alerts.alertCount).toBe(alerts.lines.length);
    expect(alerts.lines.join("\n")).toMatch(/Low feed: poultry/);
  });

  test("respects LOW_FEED_ALERT_DAYS override", async () => {
    prime();
    process.env.LOW_FEED_ALERT_DAYS = "2";
    const alerts = await composeAlerts(new Date("2026-06-22T00:00:00.000Z"));
    // poultry (3 days) is now above the 2-day threshold -> no low feed.
    expect(alerts.lowFeed).toHaveLength(0);
  });

  test("adds frost/heat from open-meteo when coordinates are set", async () => {
    prime();
    process.env.HOMESTEAD_LATITUDE = "45";
    process.env.HOMESTEAD_LONGITUDE = "-93";
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        daily: {
          time: ["2026-06-22"],
          temperature_2m_min: [-1],
          temperature_2m_max: [35],
        },
      }),
    }));
    const alerts = await composeAlerts(new Date("2026-06-22T00:00:00.000Z"));
    expect(alerts.weather.frost).toBe(true);
    expect(alerts.weather.heat).toBe(true);
    expect(alerts.lines.join("\n")).toMatch(/Frost warning/);
    expect(alerts.lines.join("\n")).toMatch(/Heat warning/);
  });

  test("a weather fetch failure never breaks composition", async () => {
    prime();
    process.env.HOMESTEAD_LATITUDE = "45";
    process.env.HOMESTEAD_LONGITUDE = "-93";
    globalThis.fetch = jest.fn(async () => { throw new Error("network down"); });
    const alerts = await composeAlerts(new Date("2026-06-22T00:00:00.000Z"));
    expect(alerts.weather).toBeNull();
  });
});

describe("alerts handler", () => {
  test("always publishes HomesteadAlert and emails when configured", async () => {
    prime();
    publishEvent.mockResolvedValue({});
    sesSend.mockResolvedValue({});
    process.env.DIGEST_SENDER = "from@example.com";
    process.env.DIGEST_RECIPIENT = "to@example.com";

    jest.resetModules();
    const { handler } = await import("../../api/alerts.mjs");
    await handler();

    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent.mock.calls[0][0]).toBe("HomesteadAlert");
    expect(sesSend).toHaveBeenCalledTimes(1);
  });

  test("an SES failure never fails the schedule", async () => {
    prime();
    publishEvent.mockResolvedValue({});
    sesSend.mockRejectedValue(new Error("SES down"));
    process.env.DIGEST_SENDER = "from@example.com";
    process.env.DIGEST_RECIPIENT = "to@example.com";

    jest.resetModules();
    const { handler } = await import("../../api/alerts.mjs");
    await expect(handler()).resolves.toBeDefined();
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });
});
