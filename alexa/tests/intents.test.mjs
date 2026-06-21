import { jest } from "@jest/globals";

// Mock the API client module so handler tests never hit the network. The
// real ApiError / MissingTokenError classes are re-exported so the handlers'
// instanceof checks still work.
const getSummary = jest.fn();
const getHerd = jest.fn();
const recordBirth = jest.fn();
const recordDeath = jest.fn();
const moveAnimals = jest.fn();
const recordFeedPurchase = jest.fn();
const recordEggCollection = jest.fn();
const getEggStats = jest.fn();
const getEggCost = jest.fn();

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
class MissingTokenError extends Error {
  constructor() {
    super("missing");
    this.name = "MissingTokenError";
  }
}

jest.unstable_mockModule("../lib/api.mjs", () => ({
  createApiClient: () => ({
    getSummary,
    getHerd,
    recordBirth,
    recordDeath,
    moveAnimals,
    recordFeedPurchase,
    recordEggCollection,
    getEggStats,
    getEggCost,
  }),
  ApiError,
  MissingTokenError,
  tokenFromRequest: () => "tok",
}));

const {
  LaunchRequestHandler,
  GetHerdSummaryIntentHandler,
  GetHerdCountIntentHandler,
  LogFeedPurchaseIntentHandler,
  LogEggCollectionIntentHandler,
  RecordBirthIntentHandler,
  RecordDeathIntentHandler,
  MoveAnimalsIntentHandler,
  GetEggStatsIntentHandler,
  GetEggCostIntentHandler,
  HelpIntentHandler,
  CancelAndStopIntentHandler,
  FallbackIntentHandler,
  SessionEndedRequestHandler,
  GenericErrorHandler,
} = await import("../handlers/intents.mjs");

// Minimal responseBuilder mirroring the chainable ask-sdk surface used by
// the handlers, recording what was spoken / delegated / rendered so assertions
// can inspect it.
function makeResponseBuilder() {
  const state = {
    speech: null,
    reprompt: null,
    linkAccount: false,
    delegated: false,
    directives: [],
  };
  const builder = {
    speak(text) {
      state.speech = text;
      return builder;
    },
    reprompt(text) {
      state.reprompt = text;
      return builder;
    },
    withLinkAccountCard() {
      state.linkAccount = true;
      return builder;
    },
    addDelegateDirective() {
      state.delegated = true;
      return builder;
    },
    addDirective(directive) {
      state.directives.push(directive);
      return builder;
    },
    getResponse() {
      return state;
    },
  };
  return builder;
}

// device toggles APL support so we can assert the gate.
function handlerInput(request, { apl = false } = {}) {
  return {
    requestEnvelope: {
      request,
      context: {
        System: {
          device: {
            supportedInterfaces: apl ? { "Alexa.Presentation.APL": {} } : {},
          },
        },
      },
    },
    responseBuilder: makeResponseBuilder(),
  };
}

function intentRequest(name, slots = {}, dialogState = "COMPLETED") {
  return { type: "IntentRequest", dialogState, intent: { name, slots } };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("canHandle routing", () => {
  test("LaunchRequest", () => {
    expect(
      LaunchRequestHandler.canHandle(handlerInput({ type: "LaunchRequest" })),
    ).toBe(true);
  });
  test("new intents route", () => {
    expect(
      LogFeedPurchaseIntentHandler.canHandle(
        handlerInput(intentRequest("LogFeedPurchaseIntent")),
      ),
    ).toBe(true);
    expect(
      LogEggCollectionIntentHandler.canHandle(
        handlerInput(intentRequest("LogEggCollectionIntent")),
      ),
    ).toBe(true);
    expect(
      GetEggStatsIntentHandler.canHandle(
        handlerInput(intentRequest("GetEggStatsIntent")),
      ),
    ).toBe(true);
  });
  test("Cancel and Stop both route to CancelAndStop", () => {
    expect(
      CancelAndStopIntentHandler.canHandle(
        handlerInput(intentRequest("AMAZON.CancelIntent")),
      ),
    ).toBe(true);
    expect(
      CancelAndStopIntentHandler.canHandle(
        handlerInput(intentRequest("AMAZON.StopIntent")),
      ),
    ).toBe(true);
  });
  test("SessionEnded", () => {
    expect(
      SessionEndedRequestHandler.canHandle(
        handlerInput({ type: "SessionEndedRequest" }),
      ),
    ).toBe(true);
  });
});

describe("LaunchRequest / Help / Fallback", () => {
  test("launch welcomes and reprompts", () => {
    const res = LaunchRequestHandler.handle(
      handlerInput({ type: "LaunchRequest" }),
    );
    expect(res.speech).toMatch(/Welcome to Homestead/);
    expect(res.reprompt).toBeTruthy();
  });
  test("help speaks guidance", () => {
    const res = HelpIntentHandler.handle(
      handlerInput(intentRequest("AMAZON.HelpIntent")),
    );
    expect(res.speech).toMatch(/herd summary/);
  });
  test("fallback apologizes", () => {
    const res = FallbackIntentHandler.handle(
      handlerInput(intentRequest("AMAZON.FallbackIntent")),
    );
    expect(res.speech).toMatch(/didn't catch that/);
  });
  test("cancel/stop says goodbye", () => {
    const res = CancelAndStopIntentHandler.handle(
      handlerInput(intentRequest("AMAZON.StopIntent")),
    );
    expect(res.speech).toBe("Goodbye.");
  });
});

describe("GetHerdSummaryIntent", () => {
  test("calls getSummary and speaks the rendered summary", async () => {
    getSummary.mockResolvedValue({
      herd: { totalAnimals: 2, bySpecies: [{ species: "goat", active: 2 }] },
      births: { thisMonth: 0 },
      deaths: { thisMonth: 0 },
      feed: { thisMonthSpend: 0 },
    });
    const res = await GetHerdSummaryIntentHandler.handle(
      handlerInput(intentRequest("GetHerdSummaryIntent")),
    );
    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(res.speech).toContain("2 animals");
  });

  test("prompts to link account on MissingTokenError", async () => {
    getSummary.mockRejectedValue(new MissingTokenError());
    const res = await GetHerdSummaryIntentHandler.handle(
      handlerInput(intentRequest("GetHerdSummaryIntent")),
    );
    expect(res.linkAccount).toBe(true);
    expect(res.speech).toMatch(/link your Homestead account/);
  });

  test("prompts to link account on a 401 ApiError", async () => {
    getSummary.mockRejectedValue(new ApiError(401, "Unauthorized"));
    const res = await GetHerdSummaryIntentHandler.handle(
      handlerInput(intentRequest("GetHerdSummaryIntent")),
    );
    expect(res.linkAccount).toBe(true);
  });

  test("speaks a generic error on a 500", async () => {
    getSummary.mockRejectedValue(new ApiError(500, "boom"));
    const res = await GetHerdSummaryIntentHandler.handle(
      handlerInput(intentRequest("GetHerdSummaryIntent")),
    );
    expect(res.linkAccount).toBe(false);
    expect(res.speech).toMatch(/couldn't get your homestead summary/);
  });
});

describe("GetHerdCountIntent", () => {
  test("calls getHerd and speaks the count", async () => {
    getHerd.mockResolvedValue({
      total: 3,
      byStatus: { active: 3 },
      bySpecies: { goat: { total: 3, active: 3 } },
    });
    const res = await GetHerdCountIntentHandler.handle(
      handlerInput(intentRequest("GetHerdCountIntent")),
    );
    expect(getHerd).toHaveBeenCalledTimes(1);
    expect(res.speech).toContain("3 animals");
  });
});

describe("dialog delegation (write intents)", () => {
  test("LogFeedPurchase delegates while the dialog is incomplete", async () => {
    const res = await LogFeedPurchaseIntentHandler.handle(
      handlerInput(
        intentRequest("LogFeedPurchaseIntent", {}, "IN_PROGRESS"),
      ),
    );
    expect(res.delegated).toBe(true);
    expect(recordFeedPurchase).not.toHaveBeenCalled();
  });

  test("LogFeedPurchase posts bags+weight when COMPLETED and confirms", async () => {
    recordFeedPurchase.mockResolvedValue({
      bags: 4,
      bagWeightLbs: 50,
      feedType: "chicken",
    });
    const res = await LogFeedPurchaseIntentHandler.handle(
      handlerInput(
        intentRequest("LogFeedPurchaseIntent", {
          bags: { value: "4" },
          bagWeight: { value: "50" },
          feedType: { value: "chicken" },
        }),
      ),
    );
    expect(recordFeedPurchase).toHaveBeenCalledWith({
      bags: 4,
      bagWeightLbs: 50,
      feedType: "chicken",
    });
    expect(res.delegated).toBe(false);
    expect(res.speech).toContain("4 fifty-pound bags of chicken feed");
  });

  test("RecordBirth delegates while incomplete, posts when complete", async () => {
    const inprog = await RecordBirthIntentHandler.handle(
      handlerInput(intentRequest("RecordBirthIntent", {}, "STARTED")),
    );
    expect(inprog.delegated).toBe(true);
    expect(recordBirth).not.toHaveBeenCalled();

    recordBirth.mockResolvedValue({ animal: { species: "goat" } });
    const done = await RecordBirthIntentHandler.handle(
      handlerInput(
        intentRequest("RecordBirthIntent", {
          species: { value: "goat" },
          count: { value: "2" },
        }),
      ),
    );
    expect(recordBirth).toHaveBeenCalledWith({ species: "goat", count: 2 });
    expect(done.speech).toMatch(/recorded the birth of a goat/);
  });

  test("RecordDeath delegates then posts", async () => {
    const inprog = await RecordDeathIntentHandler.handle(
      handlerInput(intentRequest("RecordDeathIntent", {}, "IN_PROGRESS")),
    );
    expect(inprog.delegated).toBe(true);

    recordDeath.mockResolvedValue(null);
    const done = await RecordDeathIntentHandler.handle(
      handlerInput(
        intentRequest("RecordDeathIntent", { animalRef: { value: "Bessie" } }),
      ),
    );
    expect(recordDeath).toHaveBeenCalledWith({ animalRef: "Bessie" });
    expect(done.speech).toMatch(/recorded that death/);
  });

  test("MoveAnimals delegates then posts and names group + pasture", async () => {
    const inprog = await MoveAnimalsIntentHandler.handle(
      handlerInput(intentRequest("MoveAnimalsIntent", {}, "IN_PROGRESS")),
    );
    expect(inprog.delegated).toBe(true);

    moveAnimals.mockResolvedValue(null);
    const done = await MoveAnimalsIntentHandler.handle(
      handlerInput(
        intentRequest("MoveAnimalsIntent", {
          group: { value: "the goats" },
          pasture: { value: "south field" },
        }),
      ),
    );
    expect(moveAnimals).toHaveBeenCalledWith({
      group: "the goats",
      pasture: "south field",
    });
    expect(done.speech).toContain("the goats");
    expect(done.speech).toContain("south field");
  });

  test("LogEggCollection delegates then posts and confirms", async () => {
    const inprog = await LogEggCollectionIntentHandler.handle(
      handlerInput(intentRequest("LogEggCollectionIntent", {}, "IN_PROGRESS")),
    );
    expect(inprog.delegated).toBe(true);

    recordEggCollection.mockResolvedValue({ count: 12 });
    const done = await LogEggCollectionIntentHandler.handle(
      handlerInput(
        intentRequest("LogEggCollectionIntent", { count: { value: "a dozen" } }),
      ),
    );
    expect(recordEggCollection).toHaveBeenCalledWith({ count: 12 });
    expect(done.speech).toContain("12 eggs");
  });

  test("delegated write intents surface auth errors on COMPLETED", async () => {
    recordFeedPurchase.mockRejectedValue(new MissingTokenError());
    const res = await LogFeedPurchaseIntentHandler.handle(
      handlerInput(
        intentRequest("LogFeedPurchaseIntent", {
          bags: { value: "1" },
          bagWeight: { value: "50" },
          feedType: { value: "chicken" },
        }),
      ),
    );
    expect(res.linkAccount).toBe(true);
  });
});

describe("egg read intents + APL gating", () => {
  test("GetEggStats speaks stats and renders APL on capable devices", async () => {
    getEggStats.mockResolvedValue({
      count: 84,
      dozens: 7,
      perDay: 3,
      periodLabel: "this month",
    });
    const res = await GetEggStatsIntentHandler.handle(
      handlerInput(intentRequest("GetEggStatsIntent"), { apl: true }),
    );
    expect(getEggStats).toHaveBeenCalledWith({});
    expect(res.speech).toContain("84 eggs this month");
    expect(res.directives).toHaveLength(1);
    expect(res.directives[0].type).toBe(
      "Alexa.Presentation.APL.RenderDocument",
    );
  });

  test("GetEggStats stays voice-only on headless devices", async () => {
    getEggStats.mockResolvedValue({ count: 10, perDay: 1 });
    const res = await GetEggStatsIntentHandler.handle(
      handlerInput(intentRequest("GetEggStatsIntent"), { apl: false }),
    );
    expect(res.directives).toHaveLength(0);
    expect(res.speech).toBeTruthy();
  });

  test("GetEggStats passes the period slot through", async () => {
    getEggStats.mockResolvedValue({ count: 5, perDay: 1 });
    await GetEggStatsIntentHandler.handle(
      handlerInput(
        intentRequest("GetEggStatsIntent", { period: { value: "this week" } }),
      ),
    );
    expect(getEggStats).toHaveBeenCalledWith({ period: "this week" });
  });

  test("GetEggCost speaks the break-even comparison + renders APL", async () => {
    getEggCost.mockResolvedValue({
      costPerDozen: 2.1,
      storePricePerDozen: 4,
    });
    const res = await GetEggCostIntentHandler.handle(
      handlerInput(intentRequest("GetEggCostIntent"), { apl: true }),
    );
    expect(res.speech).toContain("cheaper than the $4 store price");
    expect(res.directives).toHaveLength(1);
  });
});

describe("error + session handlers", () => {
  test("SessionEnded returns a response without speech", () => {
    const res = SessionEndedRequestHandler.handle(
      handlerInput({ type: "SessionEndedRequest" }),
    );
    expect(res.speech).toBeNull();
  });

  test("GenericErrorHandler always canHandle and speaks a retry", () => {
    expect(GenericErrorHandler.canHandle()).toBe(true);
    const res = GenericErrorHandler.handle(
      handlerInput(intentRequest("Whatever")),
      new Error("kaboom"),
    );
    expect(res.speech).toMatch(/something went wrong/);
  });
});
