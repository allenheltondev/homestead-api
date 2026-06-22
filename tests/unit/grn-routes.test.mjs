import { jest } from "@jest/globals";

process.env.EVENT_BUS_NAME = "default";

const listMyListings = jest.fn();
const discoverListings = jest.fn();
const listRequests = jest.fn();
const createClaim = jest.fn();
const getClaim = jest.fn();
jest.unstable_mockModule("../../api/lib/grn.mjs", () => ({
  listMyListings, discoverListings, listRequests, createClaim, getClaim,
}));

const publishEvent = jest.fn();
jest.unstable_mockModule("../../api/services/events.mjs", () => ({ publishEvent }));

const { registerGrnRoutes } = await import("../../api/routes/grn.mjs");
const {
  buildListingPayload,
  validateDiscoverQuery,
  validateClaimCreate,
} = await import("../../api/validation/grn.mjs");

function fakeApp() {
  const routes = {};
  const register = (method) => (path, handler) => { routes[`${method} ${path}`] = handler; };
  return { post: register("POST"), get: register("GET"), routes };
}

beforeEach(() => {
  listMyListings.mockReset();
  discoverListings.mockReset();
  listRequests.mockReset();
  createClaim.mockReset();
  getClaim.mockReset();
  publishEvent.mockReset();
});

const UUID = "11111111-2222-3333-4444-555555555555";

describe("validateDiscoverQuery", () => {
  test("derives a coarse geoKey from lat/lng + passes radius", () => {
    expect(validateDiscoverQuery({ lat: "40.12", lng: "-75.26", radius: "5" }))
      .toEqual({ geoKey: "40.1,-75.3", radiusMiles: 5 });
  });
  test("accepts an explicit geoKey", () => {
    expect(validateDiscoverQuery({ geoKey: "abc" })).toEqual({ geoKey: "abc" });
  });
  test("requires geoKey or lat+lng", () => {
    expect(() => validateDiscoverQuery({})).toThrow(/geoKey/);
  });
  test("rejects out-of-range lat", () => {
    expect(() => validateDiscoverQuery({ lat: "200", lng: "0" })).toThrow(/lat/);
  });
});

describe("validateClaimCreate", () => {
  test("requires a uuid listingId + positive quantityClaimed", () => {
    expect(validateClaimCreate({ listingId: UUID, quantityClaimed: 2 }))
      .toEqual({ listingId: UUID, quantityClaimed: 2 });
  });
  test("rejects a non-uuid listingId", () => {
    expect(() => validateClaimCreate({ listingId: "x", quantityClaimed: 1 })).toThrow(/listingId/);
  });
});

describe("buildListingPayload", () => {
  const harvest = { cropName: "Tomato", variety: "Roma", quantity: 5, unit: "lb", harvestedAt: "2026-06-15T00:00:00.000Z" };
  test("maps harvest + body to the GRN UpsertListingRequest fields", () => {
    const payload = buildListingPayload(harvest, { cropId: UUID, availableEnd: "2026-06-30" });
    expect(payload.cropId).toBe(UUID);
    expect(payload.quantityTotal).toBe(5);
    expect(payload.unit).toBe("lb");
    expect(payload.availableStart).toBe("2026-06-15T00:00:00.000Z");
    expect(payload.availableEnd).toBe("2026-06-30T00:00:00.000Z");
    expect(payload.status).toBe("active");
    expect(payload.title).toBe("Tomato (Roma)");
  });
  test("requires cropId + availableEnd", () => {
    expect(() => buildListingPayload(harvest, { availableEnd: "2026-06-30" })).toThrow(/cropId/);
    expect(() => buildListingPayload(harvest, { cropId: UUID })).toThrow(/availableEnd/);
  });
});

describe("grn proxy routes", () => {
  test("GET /grn/my-listings passes through the upstream payload", async () => {
    listMyListings.mockResolvedValue({ items: [{ id: "L1" }] });
    const app = fakeApp();
    registerGrnRoutes(app);
    const res = await app.routes["GET /grn/my-listings"]({ event: { queryStringParameters: {} } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ items: [{ id: "L1" }] });
  });

  test("POST /grn/claims forwards Idempotency-Key + emits GrnClaimCreated", async () => {
    createClaim.mockResolvedValue({ id: "C1" });
    publishEvent.mockResolvedValue({});
    const app = fakeApp();
    registerGrnRoutes(app);
    const event = {
      body: JSON.stringify({ listingId: UUID, quantityClaimed: 2 }),
      headers: { "Idempotency-Key": "idem-1" },
    };
    const res = await app.routes["POST /grn/claims"]({ event });
    expect(res.statusCode).toBe(201);
    expect(createClaim.mock.calls[0][1].idempotencyKey).toBe("idem-1");
    expect(publishEvent.mock.calls[0][0]).toBe("GrnClaimCreated");
  });

  test("GET /grn/claims/:id proxies getClaim", async () => {
    getClaim.mockResolvedValue({ id: "C1", status: "pending" });
    const app = fakeApp();
    registerGrnRoutes(app);
    const res = await app.routes["GET /grn/claims/:id"]({ event: {}, params: { id: "C1" } });
    expect(JSON.parse(res.body).status).toBe("pending");
  });
});
