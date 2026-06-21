import { jest } from "@jest/globals";

// Tests for the agent-fallback handlers (CatchAll, Fallback routing, and the
// Yes/No confirm-gated write handlers). The agent module is mocked so we assert
// routing + the confirm flow without touching Bedrock; the API client is mocked
// so the Yes handler's write execution is observable.

const runAgent = jest.fn(() => ({ kind: "agent-response" }));

jest.unstable_mockModule("../lib/agent.mjs", () => ({
  runAgent,
  PENDING_ACTION_KEY: "pendingAction",
}));

const recordDeath = jest.fn();
const recordBirth = jest.fn();

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
    recordDeath,
    recordBirth,
    getSummary: jest.fn(),
    getHerd: jest.fn(),
    moveAnimals: jest.fn(),
    recordFeedPurchase: jest.fn(),
    recordEggCollection: jest.fn(),
    getEggStats: jest.fn(),
    getEggCost: jest.fn(),
    recordFeedUsage: jest.fn(),
    getFeedInventory: jest.fn(),
    recordHealthExpense: jest.fn(),
    getHealthStats: jest.fn(),
    getMortality: jest.fn(),
    getDigest: jest.fn(),
  }),
  ApiError,
  MissingTokenError,
  tokenFromRequest: () => "tok",
}));

const {
  CatchAllIntentHandler,
  FallbackIntentHandler,
  ConfirmActionYesIntentHandler,
  ConfirmActionNoIntentHandler,
  handlers,
} = await import("../handlers/intents.mjs");

const PENDING_ACTION_KEY = "pendingAction";

function makeResponseBuilder() {
  const state = { speech: null, reprompt: null, linkAccount: false };
  const builder = {
    speak(t) {
      state.speech = t;
      return builder;
    },
    reprompt(t) {
      state.reprompt = t;
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

function makeHandlerInput(request, initialAttrs = {}) {
  let attrs = { ...initialAttrs };
  return {
    requestEnvelope: { request, context: {} },
    responseBuilder: makeResponseBuilder(),
    attributesManager: {
      getSessionAttributes: () => attrs,
      setSessionAttributes: (next) => {
        attrs = next;
      },
    },
  };
}

function intentRequest(name, slots = {}) {
  return { type: "IntentRequest", intent: { name, slots } };
}

beforeEach(() => jest.clearAllMocks());

describe("routing", () => {
  test("CatchAllIntent passes the query slot to runAgent", () => {
    const hi = makeHandlerInput(
      intentRequest("CatchAllIntent", { query: { value: "do I have any goats" } }),
    );
    CatchAllIntentHandler.handle(hi);
    expect(runAgent).toHaveBeenCalledWith({
      handlerInput: hi,
      utterance: "do I have any goats",
    });
  });

  test("FallbackIntent routes into runAgent (generic when no phrase)", () => {
    const hi = makeHandlerInput(intentRequest("AMAZON.FallbackIntent"));
    FallbackIntentHandler.handle(hi);
    expect(runAgent).toHaveBeenCalledWith({
      handlerInput: hi,
      utterance: undefined,
    });
  });

  test("Yes/No register before the catch-all", () => {
    const yesIdx = handlers.indexOf(ConfirmActionYesIntentHandler);
    const noIdx = handlers.indexOf(ConfirmActionNoIntentHandler);
    const catchIdx = handlers.indexOf(CatchAllIntentHandler);
    expect(yesIdx).toBeGreaterThanOrEqual(0);
    expect(noIdx).toBeGreaterThanOrEqual(0);
    expect(catchIdx).toBeGreaterThan(yesIdx);
    expect(catchIdx).toBeGreaterThan(noIdx);
  });
});

describe("YesIntent (confirm pending write)", () => {
  test("executes the pending write and clears it", async () => {
    recordDeath.mockResolvedValue(null);
    const hi = makeHandlerInput(intentRequest("AMAZON.YesIntent"), {
      [PENDING_ACTION_KEY]: {
        name: "record_death",
        args: { animalRef: "Bessie" },
        phrase: "Record the death of Bessie",
      },
    });
    const res = await ConfirmActionYesIntentHandler.handle(hi);
    expect(recordDeath).toHaveBeenCalledWith({ animalRef: "Bessie" });
    expect(res.speech).toMatch(/Done/);
    expect(
      hi.attributesManager.getSessionAttributes()[PENDING_ACTION_KEY],
    ).toBeUndefined();
  });

  test("with nothing pending falls through to a help prompt", async () => {
    const hi = makeHandlerInput(intentRequest("AMAZON.YesIntent"));
    const res = await ConfirmActionYesIntentHandler.handle(hi);
    expect(recordDeath).not.toHaveBeenCalled();
    expect(res.speech).toMatch(/don't have anything to confirm/);
  });

  test("surfaces auth errors as the link-account prompt", async () => {
    recordBirth.mockRejectedValue(new MissingTokenError());
    const hi = makeHandlerInput(intentRequest("AMAZON.YesIntent"), {
      [PENDING_ACTION_KEY]: {
        name: "record_birth",
        args: { species: "goat", count: 2 },
        phrase: "Record the birth of 2 goats",
      },
    });
    const res = await ConfirmActionYesIntentHandler.handle(hi);
    expect(res.linkAccount).toBe(true);
  });
});

describe("NoIntent (cancel pending write)", () => {
  test("discards the pending write and acknowledges", () => {
    const hi = makeHandlerInput(intentRequest("AMAZON.NoIntent"), {
      [PENDING_ACTION_KEY]: { name: "record_death", args: {}, phrase: "x" },
    });
    const res = ConfirmActionNoIntentHandler.handle(hi);
    expect(res.speech).toMatch(/won't do that/);
    expect(
      hi.attributesManager.getSessionAttributes()[PENDING_ACTION_KEY],
    ).toBeUndefined();
    expect(recordDeath).not.toHaveBeenCalled();
  });

  test("with nothing pending offers help", () => {
    const hi = makeHandlerInput(intentRequest("AMAZON.NoIntent"));
    const res = ConfirmActionNoIntentHandler.handle(hi);
    expect(res.speech).toMatch(/Okay/);
  });
});
