import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";
process.env.EVENT_BUS_NAME = "default";

// Mock the domains composeAlerts uses so importing alerts.mjs is side-effect
// free; this suite only exercises syncGrnClaimStatus.
jest.unstable_mockModule("../../api/domain/stats.mjs", () => ({ feedInventory: jest.fn() }));
jest.unstable_mockModule("../../api/domain/careTask.mjs", () => ({ listCareTasksDue: jest.fn() }));
jest.unstable_mockModule("../../api/domain/breeding.mjs", () => ({ listBreedingsDue: jest.fn() }));
jest.unstable_mockModule("../../api/domain/incubation.mjs", () => ({ listIncubationBatches: jest.fn() }));

const isGrnConfigured = jest.fn();
const listMyListings = jest.fn();
jest.unstable_mockModule("../../api/lib/grn.mjs", () => ({ isGrnConfigured, listMyListings }));

const publishEvent = jest.fn();
jest.unstable_mockModule("../../api/services/events.mjs", () => ({ publishEvent }));

jest.unstable_mockModule("@aws-sdk/client-ses", () => ({
  SESClient: jest.fn(() => ({ send: jest.fn() })),
  SendEmailCommand: jest.fn((input) => ({ input })),
}));

const { syncGrnClaimStatus } = await import("../../api/alerts.mjs");

beforeEach(() => {
  isGrnConfigured.mockReset();
  listMyListings.mockReset();
  publishEvent.mockReset();
});

describe("syncGrnClaimStatus", () => {
  test("returns [] and skips when GRN unconfigured", async () => {
    isGrnConfigured.mockReturnValue(false);
    expect(await syncGrnClaimStatus()).toEqual([]);
    expect(listMyListings).not.toHaveBeenCalled();
  });

  test("fetches claimed listings + emits GrnListingClaimed per listing", async () => {
    isGrnConfigured.mockReturnValue(true);
    listMyListings.mockResolvedValue({ items: [{ id: "L1", status: "claimed", title: "Tomatoes" }] });
    publishEvent.mockResolvedValue({});

    const lines = await syncGrnClaimStatus();
    expect(lines).toEqual([expect.stringMatching(/claimed: Tomatoes/i)]);
    // It queries only claimed listings upstream.
    expect(listMyListings.mock.calls[0][0].status).toBe("claimed");
    expect(publishEvent.mock.calls[0][0]).toBe("GrnListingClaimed");
    expect(publishEvent.mock.calls[0][1].grnListingId).toBe("L1");
  });

  test("no-ops with no claimed listings", async () => {
    isGrnConfigured.mockReturnValue(true);
    listMyListings.mockResolvedValue({ items: [] });
    const lines = await syncGrnClaimStatus();
    expect(lines).toEqual([]);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  test("never throws when GRN errors (best-effort)", async () => {
    isGrnConfigured.mockReturnValue(true);
    listMyListings.mockRejectedValue(new Error("GRN down"));
    expect(await syncGrnClaimStatus()).toEqual([]);
  });
});
