import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";
process.env.EVENT_BUS_NAME = "default";

// Mock the domains composeAlerts uses so importing alerts.mjs is side-effect
// free; this suite only exercises syncGrnClaimStatus.
jest.unstable_mockModule("../../api/domain/stats.mjs", () => ({ feedInventory: jest.fn() }));
jest.unstable_mockModule("../../api/domain/careTask.mjs", () => ({ listCareTasksDue: jest.fn() }));
jest.unstable_mockModule("../../api/domain/breeding.mjs", () => ({ listBreedingsDue: jest.fn() }));
jest.unstable_mockModule("../../api/domain/incubation.mjs", () => ({ listIncubationBatches: jest.fn() }));

const listLinkedHarvestLogs = jest.fn();
const updateHarvestGrnFields = jest.fn();
jest.unstable_mockModule("../../api/domain/harvest.mjs", () => ({
  listLinkedHarvestLogs, updateHarvestGrnFields,
}));

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
  listLinkedHarvestLogs.mockReset();
  updateHarvestGrnFields.mockReset();
  isGrnConfigured.mockReset();
  listMyListings.mockReset();
  publishEvent.mockReset();
});

describe("syncGrnClaimStatus", () => {
  test("returns [] and skips when GRN unconfigured", async () => {
    isGrnConfigured.mockReturnValue(false);
    expect(await syncGrnClaimStatus()).toEqual([]);
    expect(listLinkedHarvestLogs).not.toHaveBeenCalled();
  });

  test("reconciles a newly claimed listing + emits GrnListingClaimed", async () => {
    isGrnConfigured.mockReturnValue(true);
    listLinkedHarvestLogs.mockResolvedValue([
      { id: "h1", cropName: "Tomato", quantity: 5, unit: "lb", grnListingId: "L1", grnStatus: "active" },
    ]);
    listMyListings.mockResolvedValue({ items: [{ id: "L1", status: "claimed" }] });
    updateHarvestGrnFields.mockResolvedValue({});
    publishEvent.mockResolvedValue({});

    const lines = await syncGrnClaimStatus();
    expect(lines).toEqual([expect.stringMatching(/claimed: Tomato/i)]);
    expect(updateHarvestGrnFields).toHaveBeenCalledWith("h1", { grnStatus: "claimed" });
    expect(publishEvent.mock.calls[0][0]).toBe("GrnListingClaimed");
  });

  test("no-ops when upstream status is unchanged", async () => {
    isGrnConfigured.mockReturnValue(true);
    listLinkedHarvestLogs.mockResolvedValue([
      { id: "h1", cropName: "Tomato", grnListingId: "L1", grnStatus: "active" },
    ]);
    listMyListings.mockResolvedValue({ items: [{ id: "L1", status: "active" }] });
    const lines = await syncGrnClaimStatus();
    expect(lines).toEqual([]);
    expect(updateHarvestGrnFields).not.toHaveBeenCalled();
  });

  test("never throws when GRN errors (best-effort)", async () => {
    isGrnConfigured.mockReturnValue(true);
    listLinkedHarvestLogs.mockResolvedValue([
      { id: "h1", cropName: "Tomato", grnListingId: "L1", grnStatus: "active" },
    ]);
    listMyListings.mockRejectedValue(new Error("GRN down"));
    expect(await syncGrnClaimStatus()).toEqual([]);
  });
});
