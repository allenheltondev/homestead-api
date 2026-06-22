import { jest } from "@jest/globals";

process.env.API_BASE_URL = "https://api.example.test/v1";

const {
  createApiClient,
  tokenFromRequest,
  ApiError,
  MissingTokenError,
  grnCropList,
  resolveCropLibraryId,
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

  test("getEggCost appends a flock filter", async () => {
    const fetchMock = mockFetch(200, { costPerDozen: 2.1 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getEggCost({ flock: "north" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/egg-cost?flock=north",
    );
  });

  test("getEggCost appends both period and flock", async () => {
    const fetchMock = mockFetch(200, { costPerDozen: 2.1 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getEggCost({ period: "this month", flock: "north" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/egg-cost?period=this+month&flock=north",
    );
  });

  test("recordHealthExpense POSTs JSON to /health-expenses", async () => {
    const fetchMock = mockFetch(201, { id: "h1", category: "vet", cost: 60 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.recordHealthExpense({ category: "vet", cost: 60 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/health-expenses");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ category: "vet", cost: 60 });
  });

  test("getHealthStats GETs /stats/health with the period query", async () => {
    const fetchMock = mockFetch(200, { total: 150 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getHealthStats({ period: "this month" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/health?period=this+month",
    );
  });

  test("getMortality GETs /stats/mortality, omitting an empty query", async () => {
    const fetchMock = mockFetch(200, { deaths: 2 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getMortality({});

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/mortality",
    );
  });

  test("getDigest GETs /stats/digest", async () => {
    const fetchMock = mockFetch(200, { lines: ["a", "b"] });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getDigest();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/stats/digest");
    expect(init.method).toBe("GET");
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

  // --- New feature bundles ------------------------------------------------

  test("recordMilk POSTs volume + unit to /milk-logs", async () => {
    const fetchMock = mockFetch(201, { id: "m1", volume: 2, unit: "gal" });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.recordMilk({ volume: 2, unit: "gal", animal: "Daisy" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/milk-logs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      volume: 2,
      unit: "gal",
      animal: "Daisy",
    });
  });

  test("getMilkStats GETs /stats/milk with the period query", async () => {
    const fetchMock = mockFetch(200, { total: 14 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getMilkStats({ period: "this month" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/milk?period=this+month",
    );
  });

  test("getMilkCost GETs /stats/milk-cost", async () => {
    const fetchMock = mockFetch(200, { costPerGallon: 3 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getMilkCost({});

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/milk-cost",
    );
  });

  test("getCareDue GETs /stats/care/due with a withinDays filter", async () => {
    const fetchMock = mockFetch(200, { tasks: [] });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getCareDue(7);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/care/due?withinDays=7",
    );
  });

  test("getCareDue omits the query when no withinDays is given", async () => {
    const fetchMock = mockFetch(200, { tasks: [] });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getCareDue();

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/care/due",
    );
  });

  test("completeCareTask POSTs to /care-tasks/{id}/complete", async () => {
    const fetchMock = mockFetch(200, { ok: true });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.completeCareTask("task-42");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.example.test/v1/care-tasks/task-42/complete",
    );
    expect(init.method).toBe("POST");
  });

  test("getUpcomingDue fans out to breeding + incubation", async () => {
    const fetchMock = jest.fn(async (url) => {
      const body = url.includes("breeding")
        ? { upcoming: [{ dam: "Daisy" }] }
        : { batches: [{ species: "chicken" }] };
      return {
        status: 200,
        ok: true,
        text: async () => JSON.stringify(body),
      };
    });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    const result = await api.getUpcomingDue(14);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain(
      "https://api.example.test/v1/stats/breeding/upcoming?withinDays=14",
    );
    expect(urls).toContain("https://api.example.test/v1/stats/incubation");
    expect(result.breeding.upcoming).toHaveLength(1);
    expect(result.incubation.batches).toHaveLength(1);
  });

  test("getPnl GETs /stats/pnl with the period query", async () => {
    const fetchMock = mockFetch(200, { net: 150 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getPnl({ period: "this year" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/pnl?period=this+year",
    );
  });

  // --- Garden pillar + Good Roots Network (GRN) ---------------------------

  test("listGrnCrops GETs /grn/crops", async () => {
    const fetchMock = mockFetch(200, { crops: [{ id: "c1", name: "Tomatoes" }] });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.listGrnCrops();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/grn/crops");
    expect(init.method).toBe("GET");
  });

  test("recordHarvest POSTs the harvest body to /grn/crops/{id}/harvests", async () => {
    const fetchMock = mockFetch(201, { id: "h1", amount: 5 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.recordHarvest({
      cropLibraryId: "c1",
      amount: 5,
      unit: "lb",
      harvestedOn: "2026-06-22",
      notes: "ripe",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/grn/crops/c1/harvests");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      amount: 5,
      unit: "lb",
      harvestedOn: "2026-06-22",
      notes: "ripe",
    });
  });

  test("recordHarvest omits unset optional fields from the body", async () => {
    const fetchMock = mockFetch(201, { id: "h2" });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.recordHarvest({ cropLibraryId: "c2", amount: 3, unit: "lb" });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ amount: 3, unit: "lb" });
  });

  test("grnCropList normalizes array and wrapped payloads", () => {
    expect(grnCropList([{ id: "c1" }])).toEqual([{ id: "c1" }]);
    expect(grnCropList({ crops: [{ id: "c2" }] })).toEqual([{ id: "c2" }]);
    expect(grnCropList(null)).toEqual([]);
  });

  test("resolveCropLibraryId matches the crop name case-insensitively", async () => {
    const api = {
      listGrnCrops: jest.fn().mockResolvedValue({
        crops: [
          { id: "c1", name: "Tomatoes" },
          { id: "c2", name: "Kale" },
        ],
      }),
    };
    expect(await resolveCropLibraryId(api, "tomatoes")).toBe("c1");
    expect(await resolveCropLibraryId(api, "  KALE ")).toBe("c2");
    expect(await resolveCropLibraryId(api, "okra")).toBeUndefined();
    expect(await resolveCropLibraryId(api, "")).toBeUndefined();
  });

  test("getGardenStats GETs /stats/garden with the period query", async () => {
    const fetchMock = mockFetch(200, { total: 40 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getGardenStats({ period: "this month" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/garden?period=this+month",
    );
  });

  test("getGardenStats omits the query when no period is given", async () => {
    const fetchMock = mockFetch(200, { total: 0 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getGardenStats({});

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/stats/garden",
    );
  });

  test("publishSurplus POSTs to /grn/crops/{id}/publish-surplus", async () => {
    const fetchMock = mockFetch(200, { crop: "tomatoes", quantity: 3 });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.publishSurplus("c1", { quantity: 3 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.example.test/v1/grn/crops/c1/publish-surplus",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ quantity: 3 });
  });

  test("getGrnListings GETs /grn/my-listings", async () => {
    const fetchMock = mockFetch(200, { listings: [] });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getGrnListings();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/grn/my-listings");
    expect(init.method).toBe("GET");
  });

  test("getGrnRequests GETs /grn/requests", async () => {
    const fetchMock = mockFetch(200, { requests: [] });
    global.fetch = fetchMock;

    const api = createApiClient(handlerInputWithToken("tok-abc"));
    await api.getGrnRequests();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/grn/requests");
    expect(init.method).toBe("GET");
  });
});
