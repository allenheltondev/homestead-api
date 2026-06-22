import { jest } from "@jest/globals";

// --- Client wrappers (mock fetch + SSM) ---------------------------------
const ssmSend = jest.fn();
const GetParameterCommand = jest.fn((input) => ({ input, _type: "GetParameter" }));
jest.unstable_mockModule("@aws-sdk/client-ssm", () => ({
  SSMClient: jest.fn(() => ({ send: ssmSend })),
  GetParameterCommand,
}));

const grn = await import("../../api/lib/grn.mjs");
const {
  listGrowerCrops,
  createGrowerCrop,
  getGrowerCrop,
  updateGrowerCrop,
  deleteGrowerCrop,
  listGrowerBeds,
  createGrowerBed,
  getGrowerBed,
  updateGrowerBed,
  deleteGrowerBed,
  listCatalogVarieties,
  listCropHarvests,
  recordCropHarvest,
  createListing,
  updateListing,
  _resetTokenCache,
} = grn;

const originalFetch = global.fetch;

function mockFetchOnce({ status = 200, body = {}, text } = {}) {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (text !== undefined ? text : JSON.stringify(body)),
  }));
}

beforeEach(() => {
  ssmSend.mockReset();
  GetParameterCommand.mockClear();
  _resetTokenCache();
  process.env.GRN_API_BASE_URL = "https://grn.example.com";
  process.env.GRN_API_TOKEN_SSM_PATH = "/homestead/grn/token";
  ssmSend.mockResolvedValue({ Parameter: { Value: "secret-token" } });
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.GRN_API_BASE_URL;
  delete process.env.GRN_API_TOKEN_SSM_PATH;
});

describe("grn crop-library client wrappers", () => {
  test("listGrowerCrops GETs /crops with pass-through query", async () => {
    mockFetchOnce({ body: [{ id: "gc1" }] });
    const out = await listGrowerCrops({ query: { limit: 10 } });
    expect(out).toEqual([{ id: "gc1" }]);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://grn.example.com/crops?limit=10");
    expect(opts.method).toBe("GET");
  });

  test("createGrowerCrop POSTs /crops forwarding the body + idempotency key", async () => {
    mockFetchOnce({ status: 201, body: { id: "gc1" } });
    await createGrowerCrop({ crop_name: "Tomato", status: "growing" }, { idempotencyKey: "k1" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://grn.example.com/crops");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Idempotency-Key"]).toBe("k1");
    expect(JSON.parse(opts.body).crop_name).toBe("Tomato");
  });

  test("getGrowerCrop GETs /crops/{id} (encoded)", async () => {
    mockFetchOnce({ body: { id: "gc 1", canonical_id: "cat-1" } });
    const out = await getGrowerCrop("gc 1");
    expect(out.canonical_id).toBe("cat-1");
    expect(global.fetch.mock.calls[0][0]).toBe("https://grn.example.com/crops/gc%201");
  });

  test("updateGrowerCrop PUTs /crops/{id}", async () => {
    mockFetchOnce({ body: { id: "gc1" } });
    await updateGrowerCrop("gc1", { status: "paused" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://grn.example.com/crops/gc1");
    expect(opts.method).toBe("PUT");
  });

  test("deleteGrowerCrop DELETEs /crops/{id}", async () => {
    mockFetchOnce({ status: 204, text: "" });
    expect(await deleteGrowerCrop("gc1")).toBeNull();
    expect(global.fetch.mock.calls[0][1].method).toBe("DELETE");
  });

  test("listCatalogVarieties GETs /catalog/crops/{cropId}/varieties", async () => {
    mockFetchOnce({ body: [{ id: "v1" }] });
    await listCatalogVarieties("crop-1");
    expect(global.fetch.mock.calls[0][0]).toBe("https://grn.example.com/catalog/crops/crop-1/varieties");
  });
});

describe("grn garden-bed client wrappers", () => {
  test("listGrowerBeds GETs /beds", async () => {
    mockFetchOnce({ body: [{ id: "b1" }] });
    await listGrowerBeds();
    expect(global.fetch.mock.calls[0][0]).toBe("https://grn.example.com/beds");
  });
  test("createGrowerBed POSTs /beds", async () => {
    mockFetchOnce({ status: 201, body: { id: "b1" } });
    await createGrowerBed({ name: "North" }, { idempotencyKey: "k1" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://grn.example.com/beds");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Idempotency-Key"]).toBe("k1");
  });
  test("getGrowerBed / updateGrowerBed / deleteGrowerBed hit /beds/{id}", async () => {
    mockFetchOnce({ body: { id: "b1" } });
    await getGrowerBed("b1");
    expect(global.fetch.mock.calls[0][0]).toBe("https://grn.example.com/beds/b1");

    mockFetchOnce({ body: { id: "b1" } });
    await updateGrowerBed("b1", { name: "South" });
    expect(global.fetch.mock.calls[0][1].method).toBe("PUT");

    mockFetchOnce({ status: 204, text: "" });
    await deleteGrowerBed("b1");
    expect(global.fetch.mock.calls[0][1].method).toBe("DELETE");
  });
});

describe("grn crop-harvest client wrappers", () => {
  test("listCropHarvests GETs /crops/{id}/harvests", async () => {
    mockFetchOnce({ body: { growerCropId: "gc1", totalHarvested: "5", harvestCount: 1, harvests: [] } });
    const out = await listCropHarvests("gc1");
    expect(out.totalHarvested).toBe("5");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://grn.example.com/crops/gc1/harvests");
    expect(opts.method).toBe("GET");
  });

  test("recordCropHarvest POSTs /crops/{id}/harvests forwarding body + idempotency key", async () => {
    mockFetchOnce({ status: 201, body: { harvest: { id: "h1" }, totalHarvested: "5", harvestCount: 1 } });
    await recordCropHarvest("gc1", { amount: 5, unit: "lb" }, { idempotencyKey: "k1" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://grn.example.com/crops/gc1/harvests");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Idempotency-Key"]).toBe("k1");
    expect(JSON.parse(opts.body).amount).toBe(5);
  });
});

describe("grn listing client wrappers", () => {
  test("createListing POSTs /listings", async () => {
    mockFetchOnce({ status: 201, body: { id: "L1" } });
    await createListing({ cropId: "c1" }, { idempotencyKey: "k1" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://grn.example.com/listings");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Idempotency-Key"]).toBe("k1");
  });

  test("updateListing PUTs /listings/{id}", async () => {
    mockFetchOnce({ body: { id: "L1", status: "expired" } });
    await updateListing("L1", { cropId: "c1", status: "expired" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://grn.example.com/listings/L1");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body).status).toBe("expired");
  });
});
