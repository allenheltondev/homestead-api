import { jest } from "@jest/globals";

// Mock the SSM client so token reads are deterministic and never hit AWS.
const ssmSend = jest.fn();
const GetParameterCommand = jest.fn((input) => ({ input, _type: "GetParameter" }));
jest.unstable_mockModule("@aws-sdk/client-ssm", () => ({
  SSMClient: jest.fn(() => ({ send: ssmSend })),
  GetParameterCommand,
}));

const {
  grnRequest,
  createListing,
  discoverListings,
  isGrnConfigured,
  _resetTokenCache,
} = await import("../../api/lib/grn.mjs");
const {
  GrnNotConfiguredError,
  GrnUnauthorizedError,
  ApiError,
} = await import("../../api/services/errors.mjs");

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

describe("isGrnConfigured", () => {
  test("true when base URL + token path set, false otherwise", () => {
    expect(isGrnConfigured()).toBe(true);
    delete process.env.GRN_API_BASE_URL;
    expect(isGrnConfigured()).toBe(false);
  });
});

describe("grnRequest configuration errors", () => {
  test("missing base URL throws GrnNotConfiguredError", async () => {
    delete process.env.GRN_API_BASE_URL;
    await expect(grnRequest("GET", "/x")).rejects.toBeInstanceOf(GrnNotConfiguredError);
  });
  test("missing token path throws GrnNotConfiguredError", async () => {
    delete process.env.GRN_API_TOKEN_SSM_PATH;
    await expect(grnRequest("GET", "/x")).rejects.toBeInstanceOf(GrnNotConfiguredError);
  });
  test("empty SSM value throws GrnNotConfiguredError", async () => {
    ssmSend.mockResolvedValue({ Parameter: { Value: "" } });
    await expect(grnRequest("GET", "/x")).rejects.toBeInstanceOf(GrnNotConfiguredError);
  });
});

describe("grnRequest auth + headers", () => {
  test("sends Bearer token, correlation id, idempotency key, json body", async () => {
    mockFetchOnce({ status: 201, body: { id: "L1" } });
    const result = await createListing({ title: "Tomatoes" }, {
      idempotencyKey: "harvest-1",
      correlationId: "corr-1",
    });
    expect(result).toEqual({ id: "L1" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://grn.example.com/listings");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer secret-token");
    expect(opts.headers["X-Correlation-Id"]).toBe("corr-1");
    expect(opts.headers["Idempotency-Key"]).toBe("harvest-1");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body).title).toBe("Tomatoes");
  });

  test("caches the SSM token across calls (~5 min)", async () => {
    mockFetchOnce({ body: { items: [] } });
    await grnRequest("GET", "/a");
    await grnRequest("GET", "/b");
    expect(ssmSend).toHaveBeenCalledTimes(1);
    expect(GetParameterCommand.mock.calls[0][0].WithDecryption).toBe(true);
  });

  test("builds a query string, dropping empty values", async () => {
    mockFetchOnce({ body: { items: [] } });
    await discoverListings({ geoKey: "40.1,-75.2", radiusMiles: 5, status: "" });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("/listings/discover?");
    expect(url).toContain("geoKey=40.1");
    expect(url).toContain("radiusMiles=5");
    expect(url).not.toContain("status=");
  });
});

describe("grnRequest error mapping", () => {
  test("401/403 -> GrnUnauthorizedError", async () => {
    mockFetchOnce({ status: 403 });
    await expect(grnRequest("GET", "/x")).rejects.toBeInstanceOf(GrnUnauthorizedError);
  });
  test("other non-2xx -> ApiError carrying upstream status", async () => {
    mockFetchOnce({ status: 500, text: "boom" });
    const err = await grnRequest("GET", "/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(502);
  });
  test("network failure -> ApiError 502", async () => {
    global.fetch = jest.fn(async () => { throw new Error("ECONNREFUSED"); });
    await expect(grnRequest("GET", "/x")).rejects.toBeInstanceOf(ApiError);
  });
  test("204 returns null", async () => {
    mockFetchOnce({ status: 204, text: "" });
    expect(await grnRequest("DELETE", "/x")).toBeNull();
  });
});
