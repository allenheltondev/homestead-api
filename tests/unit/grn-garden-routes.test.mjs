import { jest } from "@jest/globals";

// Mock the GRN client so the pass-through routes are exercised in isolation.
const fns = {
  listGrowerCrops: jest.fn(),
  createGrowerCrop: jest.fn(),
  getGrowerCrop: jest.fn(),
  updateGrowerCrop: jest.fn(),
  deleteGrowerCrop: jest.fn(),
  listGrowerBeds: jest.fn(),
  createGrowerBed: jest.fn(),
  getGrowerBed: jest.fn(),
  updateGrowerBed: jest.fn(),
  deleteGrowerBed: jest.fn(),
  listCatalogCrops: jest.fn(),
  listCatalogVarieties: jest.fn(),
  listCropHarvests: jest.fn(),
  recordCropHarvest: jest.fn(),
  createListing: jest.fn(),
  updateListing: jest.fn(),
};
jest.unstable_mockModule("../../api/lib/grn.mjs", () => fns);

const { registerGrnGardenRoutes } = await import("../../api/routes/grnGarden.mjs");
const {
  validateGrowerCropUpsert,
  validateGardenBedUpsert,
  validateListQuery,
} = await import("../../api/validation/grnGarden.mjs");
const {
  validateRecordHarvest,
  validateListingUpsert,
  buildSurplusListingPayload,
} = await import("../../api/validation/grn.mjs");

function fakeApp() {
  const routes = {};
  const register = (method) => (path, handler) => { routes[`${method} ${path}`] = handler; };
  return {
    post: register("POST"),
    get: register("GET"),
    put: register("PUT"),
    delete: register("DELETE"),
    routes,
  };
}

beforeEach(() => {
  for (const fn of Object.values(fns)) fn.mockReset();
});

const UUID = "11111111-2222-3333-4444-555555555555";
const VARIETY_UUID = "99999999-8888-7777-6666-555555555555";

describe("validateGrowerCropUpsert", () => {
  test("accepts a valid crop_name-based body", () => {
    const out = validateGrowerCropUpsert({
      crop_name: "Tomato", status: "growing", visibility: "local", surplus_enabled: true,
    });
    expect(out.crop_name).toBe("Tomato");
  });
  test("accepts canonical_id-only (no crop_name)", () => {
    const out = validateGrowerCropUpsert({
      canonical_id: UUID, status: "planning", visibility: "private", surplus_enabled: false,
    });
    expect(out.canonical_id).toBe(UUID);
  });
  test("rejects a bad status enum", () => {
    expect(() => validateGrowerCropUpsert({
      crop_name: "x", status: "nope", visibility: "local", surplus_enabled: true,
    })).toThrow(/status/);
  });
  test("requires canonical_id or crop_name", () => {
    expect(() => validateGrowerCropUpsert({
      status: "growing", visibility: "local", surplus_enabled: true,
    })).toThrow(/canonical_id or crop_name/);
  });
  test("rejects a non-uuid canonical_id", () => {
    expect(() => validateGrowerCropUpsert({
      canonical_id: "x", status: "growing", visibility: "local", surplus_enabled: true,
    })).toThrow(/canonical_id/);
  });
});

describe("validateGardenBedUpsert", () => {
  test("requires name", () => {
    expect(() => validateGardenBedUpsert({})).toThrow(/name/);
  });
  test("checks bed_type + shape + rotation enums when present", () => {
    expect(() => validateGardenBedUpsert({ name: "A", bed_type: "floating" })).toThrow(/bed_type/);
    expect(() => validateGardenBedUpsert({ name: "A", shape: "blob" })).toThrow(/shape/);
    expect(() => validateGardenBedUpsert({ name: "A", rotation_deg: 999 })).toThrow(/rotation_deg/);
  });
  test("forwards a valid body verbatim", () => {
    expect(validateGardenBedUpsert({ name: "North", bed_type: "raised", shape: "rect" }))
      .toEqual({ name: "North", bed_type: "raised", shape: "rect" });
  });
});

describe("validateListQuery", () => {
  test("passes limit/offset, drops empties", () => {
    expect(validateListQuery({ limit: "10", offset: "" })).toEqual({ limit: 10 });
  });
  test("rejects a negative limit", () => {
    expect(() => validateListQuery({ limit: "-1" })).toThrow(/limit/);
  });
});

describe("crop pass-through routes", () => {
  test("GET /grn/crops passes the upstream payload + forwards query", async () => {
    fns.listGrowerCrops.mockResolvedValue([{ id: "gc1" }]);
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const res = await app.routes["GET /grn/crops"]({ event: { queryStringParameters: { limit: "5" } } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([{ id: "gc1" }]);
    expect(fns.listGrowerCrops.mock.calls[0][0].query).toEqual({ limit: 5 });
  });

  test("POST /grn/crops validates + forwards Idempotency-Key, returns 201", async () => {
    fns.createGrowerCrop.mockResolvedValue({ id: "gc1" });
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const event = {
      body: JSON.stringify({ crop_name: "Tomato", status: "growing", visibility: "local", surplus_enabled: true }),
      headers: { "Idempotency-Key": "idem-1" },
    };
    const res = await app.routes["POST /grn/crops"]({ event });
    expect(res.statusCode).toBe(201);
    expect(fns.createGrowerCrop.mock.calls[0][1].idempotencyKey).toBe("idem-1");
  });

  test("PUT /grn/crops/:id forwards to updateGrowerCrop", async () => {
    fns.updateGrowerCrop.mockResolvedValue({ id: "gc1" });
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const event = {
      body: JSON.stringify({ crop_name: "Tomato", status: "paused", visibility: "local", surplus_enabled: true }),
    };
    const res = await app.routes["PUT /grn/crops/:id"]({ event, params: { id: "gc1" } });
    expect(res.statusCode).toBe(200);
    expect(fns.updateGrowerCrop.mock.calls[0][0]).toBe("gc1");
  });

  test("DELETE /grn/crops/:id returns 204", async () => {
    fns.deleteGrowerCrop.mockResolvedValue(null);
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const res = await app.routes["DELETE /grn/crops/:id"]({ event: {}, params: { id: "gc1" } });
    expect(res.statusCode).toBe(204);
    expect(fns.deleteGrowerCrop.mock.calls[0][0]).toBe("gc1");
  });
});

describe("catalog pass-through routes", () => {
  test("GET /grn/catalog/crops proxies listCatalogCrops", async () => {
    fns.listCatalogCrops.mockResolvedValue([{ id: "c1" }]);
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const res = await app.routes["GET /grn/catalog/crops"]({ event: {} });
    expect(JSON.parse(res.body)).toEqual([{ id: "c1" }]);
  });
  test("GET /grn/catalog/crops/:cropId/varieties proxies listCatalogVarieties", async () => {
    fns.listCatalogVarieties.mockResolvedValue([{ id: "v1" }]);
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const res = await app.routes["GET /grn/catalog/crops/:cropId/varieties"]({ event: {}, params: { cropId: "c1" } });
    expect(res.statusCode).toBe(200);
    expect(fns.listCatalogVarieties.mock.calls[0][0]).toBe("c1");
  });
});

describe("bed pass-through routes", () => {
  test("POST /grn/beds validates + returns 201", async () => {
    fns.createGrowerBed.mockResolvedValue({ id: "b1" });
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const event = { body: JSON.stringify({ name: "North", bed_type: "raised" }), headers: {} };
    const res = await app.routes["POST /grn/beds"]({ event });
    expect(res.statusCode).toBe(201);
  });
  test("DELETE /grn/beds/:id returns 204", async () => {
    fns.deleteGrowerBed.mockResolvedValue(null);
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const res = await app.routes["DELETE /grn/beds/:id"]({ event: {}, params: { id: "b1" } });
    expect(res.statusCode).toBe(204);
  });
});

describe("validateRecordHarvest", () => {
  test("requires a positive amount", () => {
    expect(() => validateRecordHarvest({ amount: 0 })).toThrow(/amount/);
    expect(() => validateRecordHarvest({})).toThrow(/amount/);
  });
  test("passes optional unit/harvestedOn/notes through", () => {
    const out = validateRecordHarvest({ amount: 3, unit: "lb", harvestedOn: "2026-06-10", notes: "ripe" });
    expect(out).toEqual({ amount: 3, unit: "lb", harvestedOn: "2026-06-10", notes: "ripe" });
  });
  test("rejects a bad harvestedOn", () => {
    expect(() => validateRecordHarvest({ amount: 3, harvestedOn: "June 10" })).toThrow(/harvestedOn/);
  });
});

describe("validateListingUpsert", () => {
  test("requires cropId/quantityTotal/unit/availableEnd", () => {
    expect(() => validateListingUpsert({ quantityTotal: 1, unit: "lb", availableEnd: "2026-06-30" }))
      .toThrow(/cropId/);
    expect(() => validateListingUpsert({ cropId: UUID, unit: "lb", availableEnd: "2026-06-30" }))
      .toThrow(/quantityTotal/);
    expect(() => validateListingUpsert({ cropId: UUID, quantityTotal: 1, unit: "lb" }))
      .toThrow(/availableEnd/);
  });
  test("normalizes dates + defaults status to active", () => {
    const out = validateListingUpsert({ cropId: UUID, quantityTotal: 5, unit: "lb", availableEnd: "2026-06-30" });
    expect(out.cropId).toBe(UUID);
    expect(out.availableEnd).toBe("2026-06-30T00:00:00.000Z");
    expect(out.status).toBe("active");
  });
});

describe("buildSurplusListingPayload", () => {
  test("uses canonical_id (passed cropId), variety_id, default_unit, crop name", () => {
    const crop = { id: "gc-1", crop_name: "Tomato", variety_id: VARIETY_UUID, default_unit: "lb" };
    const payload = buildSurplusListingPayload(crop, { amount: 5, availableEnd: "2026-06-30" }, { cropId: UUID });
    expect(payload.cropId).toBe(UUID);
    expect(payload.varietyId).toBe(VARIETY_UUID);
    expect(payload.quantityTotal).toBe(5);
    expect(payload.unit).toBe("lb");
    expect(payload.title).toBe("Tomato");
    expect(payload.status).toBe("active");
  });
  test("requires amount + availableEnd", () => {
    const crop = { id: "gc-1", crop_name: "Tomato" };
    expect(() => buildSurplusListingPayload(crop, { availableEnd: "2026-06-30" }, { cropId: UUID }))
      .toThrow(/amount/);
    expect(() => buildSurplusListingPayload(crop, { amount: 5 }, { cropId: UUID }))
      .toThrow(/availableEnd/);
  });
  test("body varietyId override wins", () => {
    const crop = { id: "gc-1", crop_name: "Tomato", variety_id: UUID };
    const payload = buildSurplusListingPayload(crop, { amount: 5, availableEnd: "2026-06-30", varietyId: VARIETY_UUID }, { cropId: UUID });
    expect(payload.varietyId).toBe(VARIETY_UUID);
  });
});

describe("crop-harvest pass-through routes", () => {
  test("GET /grn/crops/:id/harvests proxies listCropHarvests", async () => {
    fns.listCropHarvests.mockResolvedValue({ growerCropId: "gc1", totalHarvested: "5", harvestCount: 1, harvests: [] });
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const res = await app.routes["GET /grn/crops/:id/harvests"]({ event: {}, params: { id: "gc1" } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).totalHarvested).toBe("5");
    expect(fns.listCropHarvests.mock.calls[0][0]).toBe("gc1");
  });

  test("POST /grn/crops/:id/harvests validates + forwards Idempotency-Key, returns 201", async () => {
    fns.recordCropHarvest.mockResolvedValue({ harvest: { id: "h1" }, totalHarvested: "5", harvestCount: 1 });
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const event = { body: JSON.stringify({ amount: 5, unit: "lb" }), headers: { "Idempotency-Key": "idem-1" } };
    const res = await app.routes["POST /grn/crops/:id/harvests"]({ event, params: { id: "gc1" } });
    expect(res.statusCode).toBe(201);
    expect(fns.recordCropHarvest.mock.calls[0][0]).toBe("gc1");
    expect(fns.recordCropHarvest.mock.calls[0][2].idempotencyKey).toBe("idem-1");
  });

  test("POST /grn/crops/:id/harvests 400s on a non-positive amount", async () => {
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const event = { body: JSON.stringify({ amount: 0 }), headers: {} };
    const err = await app.routes["POST /grn/crops/:id/harvests"]({ event, params: { id: "gc1" } }).catch((e) => e);
    expect(err.statusCode).toBe(400);
  });
});

describe("listings pass-through routes", () => {
  test("POST /grn/listings validates + returns 201", async () => {
    fns.createListing.mockResolvedValue({ id: "L1" });
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const event = {
      body: JSON.stringify({ cropId: UUID, quantityTotal: 5, unit: "lb", availableEnd: "2026-06-30" }),
      headers: { "Idempotency-Key": "idem-1" },
    };
    const res = await app.routes["POST /grn/listings"]({ event });
    expect(res.statusCode).toBe(201);
    expect(fns.createListing.mock.calls[0][1].idempotencyKey).toBe("idem-1");
  });

  test("PUT /grn/listings/:id forwards to updateListing (unpublish via status=expired)", async () => {
    fns.updateListing.mockResolvedValue({ id: "L1", status: "expired" });
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const event = {
      body: JSON.stringify({ cropId: UUID, quantityTotal: 5, unit: "lb", availableEnd: "2026-06-30", status: "expired" }),
      headers: {},
    };
    const res = await app.routes["PUT /grn/listings/:id"]({ event, params: { id: "L1" } });
    expect(res.statusCode).toBe(200);
    expect(fns.updateListing.mock.calls[0][0]).toBe("L1");
    expect(fns.updateListing.mock.calls[0][1].status).toBe("expired");
  });
});

describe("POST /grn/crops/:id/publish-surplus", () => {
  test("resolves canonical_id -> cropId, merges body, POSTs a listing (201)", async () => {
    fns.getGrowerCrop.mockResolvedValue({ id: "gc-1", canonical_id: UUID, variety_id: VARIETY_UUID, crop_name: "Tomato" });
    fns.createListing.mockResolvedValue({ id: "L1", status: "active" });
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const event = { body: JSON.stringify({ amount: 5, availableEnd: "2026-06-30" }), headers: { "Idempotency-Key": "k1" } };
    const res = await app.routes["POST /grn/crops/:id/publish-surplus"]({ event, params: { id: "gc-1" } });
    expect(res.statusCode).toBe(201);
    expect(fns.getGrowerCrop.mock.calls[0][0]).toBe("gc-1");
    const payload = fns.createListing.mock.calls[0][0];
    expect(payload.cropId).toBe(UUID);
    expect(payload.varietyId).toBe(VARIETY_UUID);
    expect(payload.quantityTotal).toBe(5);
    expect(fns.createListing.mock.calls[0][1].idempotencyKey).toBe("k1");
  });

  test("422 when the crop has no canonical_id", async () => {
    fns.getGrowerCrop.mockResolvedValue({ id: "gc-1", canonical_id: null, crop_name: "Tomato" });
    const app = fakeApp();
    registerGrnGardenRoutes(app);
    const event = { body: JSON.stringify({ amount: 5, availableEnd: "2026-06-30" }), headers: {} };
    const err = await app.routes["POST /grn/crops/:id/publish-surplus"]({ event, params: { id: "gc-1" } }).catch((e) => e);
    expect(err.statusCode).toBe(422);
    expect(fns.createListing).not.toHaveBeenCalled();
  });
});
