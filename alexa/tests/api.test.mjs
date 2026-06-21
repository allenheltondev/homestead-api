import { jest } from "@jest/globals";

process.env.API_BASE_URL = "https://api.example.test/v1";

const {
  createApiClient,
  tokenFromRequest,
  ApiError,
  MissingTokenError,
} = await import("../lib/api.mjs");

function handlerInputWithToken(token) {
  return {
    requestEnvelope: {
      context: { System: { user: token ? { accessToken: token } : {} } },
    },
  };
}

function mockFetch(status, body) {
  return jest.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  }));
}

afterEach(() => {
  delete global.fetch;
});

describe("tokenFromRequest", () => {
  test("reads the account-linking access token", () => {
    expect(tokenFromRequest(handlerInputWithToken("tok-123"))).toBe("tok-123");
  });
  test("undefined when unlinked", () => {
    expect(tokenFromRequest(handlerInputWithToken())).toBeUndefined();
  });
});

describe("createApiClient", () => {
  test("getSummary GETs /stats/summary with a Bearer token", async () => {
    const fetchMock = mockFetch(200, { herd: { totalAnimals: 1 } });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    const result = await api.getSummary();

    expect(result).toEqual({ herd: { totalAnimals: 1 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/stats/summary");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer tok-abc");
  });

  test("recordBirth POSTs JSON body to /births", async () => {
    const fetchMock = mockFetch(201, { animal: { species: "goat" } });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    const result = await api.recordBirth({ species: "goat" });

    expect(result.animal.species).toBe("goat");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/births");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ species: "goat" });
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  test("recordFeedPurchase POSTs bags + bagWeightLbs to /feed-purchases", async () => {
    const fetchMock = mockFetch(201, { id: "1" });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.recordFeedPurchase({
      bags: 4,
      bagWeightLbs: 50,
      feedType: "chicken",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/feed-purchases");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      bags: 4,
      bagWeightLbs: 50,
      feedType: "chicken",
    });
  });

  test("recordEggCollection POSTs to /egg-collections", async () => {
    const fetchMock = mockFetch(201, { id: "egg1", count: 9 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.recordEggCollection({ count: 9 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/egg-collections");
    expect(init.method).toBe("POST");
  });

  test("getEggStats GETs /stats/eggs and appends the period query", async () => {
    const fetchMock = mockFetch(200, { count: 84 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getEggStats({ period: "this month" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.example.test/v1/stats/eggs?period=this+month",
    );
    expect(init.method).toBe("GET");
  });

  test("getEggStats omits the query when no period is given", async () => {
    const fetchMock = mockFetch(200, { count: 0 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getEggStats({});

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/eggs",
    );
  });

  test("getEggCost GETs /stats/egg-cost", async () => {
    const fetchMock = mockFetch(200, { costPerDozen: 2.1 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getEggCost({});

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/egg-cost",
    );
  });

  test("recordFeedUsage POSTs lbs + feedType to /feed-consumption", async () => {
    const fetchMock = mockFetch(201, { id: "fc1", lbs: 25, feedType: "chicken" });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.recordFeedUsage({ lbs: 25, feedType: "chicken" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/feed-consumption");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ lbs: 25, feedType: "chicken" });
  });

  test("getFeedInventory GETs /stats/feed-inventory with a feedType filter", async () => {
    const fetchMock = mockFetch(200, { onHandLbs: 120 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getFeedInventory("chicken");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.example.test/v1/stats/feed-inventory?feedType=chicken",
    );
    expect(init.method).toBe("GET");
  });

  test("getFeedInventory omits the query when no feedType is given", async () => {
    const fetchMock = mockFetch(200, { items: [] });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getFeedInventory();

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/feed-inventory",
    );
  });

  test("throws MissingTokenError when unlinked", async () => {
    global.fetch = mockFetch(200, {});
    const api = createApiClient(handlerInputWithToken());
    await expect(api.getSummary()).rejects.toBeInstanceOf(MissingTokenError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("throws ApiError with status on a non-2xx response", async () => {
    global.fetch = mockFetch(401, { message: "Unauthorized" });
    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await expect(api.getSummary()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });
  });

  test("returns null for a 204 response", async () => {
    global.fetch = mockFetch(204);
    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await expect(api.getHerd()).resolves.toBeNull();
  });

  test("ApiError and MissingTokenError are exported error classes", () => {
    expect(new ApiError(500, "x").status).toBe(500);
    expect(new MissingTokenError().name).toBe("MissingTokenError");
  });
});
