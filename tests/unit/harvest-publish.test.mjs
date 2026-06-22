import { jest } from "@jest/globals";

process.env.EVENT_BUS_NAME = "default";

const getHarvestLog = jest.fn();
const updateHarvestGrnFields = jest.fn();
const createHarvestLog = jest.fn();
const deleteHarvestLog = jest.fn();
const listHarvestLogs = jest.fn();
jest.unstable_mockModule("../../api/domain/harvest.mjs", () => ({
  getHarvestLog, updateHarvestGrnFields, createHarvestLog, deleteHarvestLog, listHarvestLogs,
}));

const createListing = jest.fn();
const expireListing = jest.fn();
const getGrowerCrop = jest.fn();
jest.unstable_mockModule("../../api/lib/grn.mjs", () => ({ createListing, expireListing, getGrowerCrop }));

const publishEvent = jest.fn();
jest.unstable_mockModule("../../api/services/events.mjs", () => ({ publishEvent }));

const { registerHarvestRoutes } = await import("../../api/routes/harvest.mjs");

function fakeApp() {
  const routes = {};
  const register = (method) => (path, handler) => { routes[`${method} ${path}`] = handler; };
  return { post: register("POST"), get: register("GET"), delete: register("DELETE"), routes };
}

const UUID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  getHarvestLog.mockReset();
  updateHarvestGrnFields.mockReset();
  createListing.mockReset();
  expireListing.mockReset();
  getGrowerCrop.mockReset();
  publishEvent.mockReset();
});

const VARIETY_UUID = "99999999-8888-7777-6666-555555555555";

describe("POST /harvest-logs/:id/publish", () => {
  test("resolves cropId from the linked grower crop, POSTs to GRN with harvest id as idempotency key, stores grn fields", async () => {
    getHarvestLog.mockResolvedValue({
      id: "h1", cropName: "Tomato", quantity: 5, unit: "lb",
      harvestedAt: "2026-06-15T00:00:00.000Z", cropLibraryId: "gc-1",
    });
    // The grower crop links to the catalog via canonical_id (+ variety_id).
    getGrowerCrop.mockResolvedValue({ id: "gc-1", canonical_id: UUID, variety_id: VARIETY_UUID });
    createListing.mockResolvedValue({ id: "L1", status: "active" });
    updateHarvestGrnFields.mockResolvedValue({
      id: "h1", cropName: "Tomato", quantity: 5, unit: "lb", harvestedAt: "t",
      grnListingId: "L1", grnStatus: "active",
    });
    publishEvent.mockResolvedValue({});

    const app = fakeApp();
    registerHarvestRoutes(app);
    const event = { body: JSON.stringify({ availableEnd: "2026-06-30" }) };
    const res = await app.routes["POST /harvest-logs/:id/publish"]({ event, params: { id: "h1" } });

    expect(res.statusCode).toBe(201);
    expect(getGrowerCrop.mock.calls[0][0]).toBe("gc-1");
    // cropId/varietyId on the listing came from the grower crop.
    const listingPayload = createListing.mock.calls[0][0];
    expect(listingPayload.cropId).toBe(UUID);
    expect(listingPayload.varietyId).toBe(VARIETY_UUID);
    expect(createListing.mock.calls[0][1].idempotencyKey).toBe("h1");
    expect(updateHarvestGrnFields).toHaveBeenCalledWith("h1", { grnListingId: "L1", grnStatus: "active" });
    expect(publishEvent.mock.calls[0][0]).toBe("GrnListingPublished");
  });

  test("422 when the harvest is not linked to a crop", async () => {
    getHarvestLog.mockResolvedValue({
      id: "h1", cropName: "Tomato", quantity: 5, unit: "lb", harvestedAt: "t",
    });
    const app = fakeApp();
    registerHarvestRoutes(app);
    const event = { body: JSON.stringify({ availableEnd: "2026-06-30" }) };
    const err = await app.routes["POST /harvest-logs/:id/publish"]({ event, params: { id: "h1" } })
      .catch((e) => e);
    expect(err.statusCode).toBe(422);
    expect(err.message).toMatch(/link this harvest to a crop/i);
    expect(getGrowerCrop).not.toHaveBeenCalled();
  });

  test("422 when the linked crop has no catalog entry", async () => {
    getHarvestLog.mockResolvedValue({
      id: "h1", cropName: "Tomato", quantity: 5, unit: "lb", harvestedAt: "t", cropLibraryId: "gc-1",
    });
    getGrowerCrop.mockResolvedValue({ id: "gc-1", canonical_id: null });
    const app = fakeApp();
    registerHarvestRoutes(app);
    const event = { body: JSON.stringify({ availableEnd: "2026-06-30" }) };
    const err = await app.routes["POST /harvest-logs/:id/publish"]({ event, params: { id: "h1" } })
      .catch((e) => e);
    expect(err.statusCode).toBe(422);
  });

  test("409 when already published", async () => {
    getHarvestLog.mockResolvedValue({ id: "h1", grnListingId: "L1", cropLibraryId: "gc-1" });
    const app = fakeApp();
    registerHarvestRoutes(app);
    const event = { body: JSON.stringify({ availableEnd: "2026-06-30" }) };
    await expect(app.routes["POST /harvest-logs/:id/publish"]({ event, params: { id: "h1" } }))
      .rejects.toThrow(/already published/i);
  });
});

describe("DELETE /harvest-logs/:id/publish", () => {
  test("expires the GRN listing + clears local fields", async () => {
    getHarvestLog.mockResolvedValue({
      id: "h1", cropName: "Tomato", quantity: 5, unit: "lb", grnListingId: "L1",
    });
    expireListing.mockResolvedValue({ id: "L1", status: "expired" });
    updateHarvestGrnFields.mockResolvedValue({ id: "h1", cropName: "Tomato", quantity: 5, unit: "lb" });
    publishEvent.mockResolvedValue({});

    const app = fakeApp();
    registerHarvestRoutes(app);
    const res = await app.routes["DELETE /harvest-logs/:id/publish"]({ event: {}, params: { id: "h1" } });
    expect(res.statusCode).toBe(200);
    expect(expireListing.mock.calls[0][0]).toBe("L1");
    expect(updateHarvestGrnFields).toHaveBeenCalledWith("h1", { grnListingId: null, grnStatus: null });
  });

  test("409 when not published", async () => {
    getHarvestLog.mockResolvedValue({ id: "h1" });
    const app = fakeApp();
    registerHarvestRoutes(app);
    await expect(app.routes["DELETE /harvest-logs/:id/publish"]({ event: {}, params: { id: "h1" } }))
      .rejects.toThrow(/not published/i);
  });
});
