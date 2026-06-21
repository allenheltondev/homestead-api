import { jest } from "@jest/globals";

// Mock the API client module so handler tests never hit the network. The
// real ApiError / MissingTokenError classes are re-exported so the handlers'
// instanceof checks still work.
const getSummary = jest.fn();
const getHerd = jest.fn();
const recordBirth = jest.fn();
const recordFeedPurchase = jest.fn();

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
    recordFeedPurchase,
  }),
  ApiError,
  MissingTokenError,
  tokenFromRequest: () => "tok",
}));

const {
  LaunchRequestHandler,
  GetHerdSummaryIntentHandler,
  GetHerdCountIntentHandler,
  RecordBirthIntentHandler,
  RecordFeedPurchaseIntentHandler,
  HelpIntentHandler,
  CancelAndStopIntentHandler,
  FallbackIntentHandler,
  SessionEndedRequestHandler,
  GenericErrorHandler,
} = await import("../handlers/intents.mjs");

// Minimal responseBuilder mirroring the chainable ask-sdk surface used by
// the handlers, recording what was spoken so assertions can inspect it.
function makeResponseBuilder() {
  const state = { speech: null, reprompt: null, linkAccount: false };
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
    getResponse() {
      return state;
    },
  };
  return builder;
}

function handlerInput(request) {
  return {
    requestEnvelope: { request },
    responseBuilder: makeResponseBuilder(),
  };
}

function intentRequest(name, slots = {}) {
  return { type: "IntentRequest", intent: { name, slots } };
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
  test("GetHerdSummaryIntent", () => {
    expect(
      GetHerdSummaryIntentHandler.canHandle(
        handlerInput(intentRequest("GetHerdSummaryIntent")),
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

describe("RecordBirthIntent", () => {
  test("maps slots to POST /births and confirms", async () => {
    recordBirth.mockResolvedValue({ animal: { species: "goat" } });
    const res = await RecordBirthIntentHandler.handle(
      handlerInput(
        intentRequest("RecordBirthIntent", { species: { value: "goat" } }),
      ),
    );
    expect(recordBirth).toHaveBeenCalledWith({ species: "goat" });
    expect(res.speech).toMatch(/recorded the birth of a goat/);
  });

  test("reprompts when species is missing and does not call the API", async () => {
    const res = await RecordBirthIntentHandler.handle(
      handlerInput(intentRequest("RecordBirthIntent", {})),
    );
    expect(recordBirth).not.toHaveBeenCalled();
    expect(res.reprompt).toMatch(/species/i);
  });
});

describe("RecordFeedPurchaseIntent", () => {
  test("maps slots to POST /feed-purchases and confirms", async () => {
    recordFeedPurchase.mockResolvedValue({
      type: "hay",
      quantity: 10,
      unit: "bale",
      cost: 80,
    });
    const res = await RecordFeedPurchaseIntentHandler.handle(
      handlerInput(
        intentRequest("RecordFeedPurchaseIntent", {
          type: { value: "hay" },
          quantity: { value: "10" },
          unit: { value: "bales" },
          cost: { value: "80" },
          vendor: { value: "Co-op" },
        }),
      ),
    );
    expect(recordFeedPurchase).toHaveBeenCalledWith({
      type: "hay",
      quantity: 10,
      unit: "bale",
      cost: 80,
      vendor: "Co-op",
    });
    expect(res.speech).toMatch(/recorded a feed purchase/);
  });

  test("reprompts on a missing required slot", async () => {
    const res = await RecordFeedPurchaseIntentHandler.handle(
      handlerInput(intentRequest("RecordFeedPurchaseIntent", {})),
    );
    expect(recordFeedPurchase).not.toHaveBeenCalled();
    expect(res.reprompt).toBeTruthy();
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
