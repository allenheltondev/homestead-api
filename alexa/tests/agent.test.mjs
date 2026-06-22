import { jest } from "@jest/globals";

// Mock the Bedrock SDK so no AWS call is made. ConverseCommand just wraps its
// input; the mocked client's `send` returns whatever the current test queued.
const sendMock = jest.fn();

class ConverseCommand {
  constructor(input) {
    this.input = input;
  }
}
class BedrockRuntimeClient {
  send(command) {
    return sendMock(command);
  }
}

jest.unstable_mockModule("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient,
  ConverseCommand,
}));

// Mock the API client so READ/WRITE tools resolve against fakes, and re-export
// the real-ish error classes so isAuthError's instanceof checks hold.
const getSummary = jest.fn();
const getHerd = jest.fn();
const recordDeath = jest.fn();

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

const apiClient = {
  getSummary,
  getHerd,
  recordDeath,
  // unused-by-these-tests methods, present so REGISTRY runners never crash
  getEggStats: jest.fn(),
  getEggCost: jest.fn(),
  getFeedInventory: jest.fn(),
  getHealthStats: jest.fn(),
  getMortality: jest.fn(),
  getDigest: jest.fn(),
  recordFeedPurchase: jest.fn(),
  recordFeedUsage: jest.fn(),
  recordEggCollection: jest.fn(),
  recordBirth: jest.fn(),
  moveAnimals: jest.fn(),
  recordHealthExpense: jest.fn(),
  getMilkStats: jest.fn(),
  getMilkCost: jest.fn(),
  getCareDue: jest.fn(),
  getUpcomingDue: jest.fn(),
  getPnl: jest.fn(),
  recordMilk: jest.fn(),
  completeCareTask: jest.fn(),
  recordHarvest: jest.fn(),
  getGardenStats: jest.fn(),
  getPlantingCalendar: jest.fn(),
  publishSurplus: jest.fn(),
  getGrnListings: jest.fn(),
  getGrnRequests: jest.fn(),
};

jest.unstable_mockModule("../lib/api.mjs", () => ({
  createApiClient: () => apiClient,
  ApiError,
  MissingTokenError,
  tokenFromRequest: () => "tok",
}));

const { runAgent, PENDING_ACTION_KEY } = await import("../lib/agent.mjs");

// --- Test scaffolding -----------------------------------------------------

function makeResponseBuilder() {
  const state = {
    speech: null,
    reprompt: null,
    linkAccount: false,
  };
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

function makeHandlerInput() {
  let attrs = {};
  return {
    requestEnvelope: { request: { type: "IntentRequest" }, context: {} },
    responseBuilder: makeResponseBuilder(),
    attributesManager: {
      getSessionAttributes: () => attrs,
      setSessionAttributes: (next) => {
        attrs = next;
      },
    },
  };
}

// Builds a Converse response shaped like the real Bedrock output.
function toolUseResponse(name, input, toolUseId = "t1") {
  return {
    stopReason: "tool_use",
    output: { message: { role: "assistant", content: [{ toolUse: { toolUseId, name, input } }] } },
  };
}
function textResponse(text) {
  return {
    stopReason: "end_turn",
    output: { message: { role: "assistant", content: [{ text }] } },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BEDROCK_MODEL_ID;
});

describe("runAgent — read-only flow", () => {
  test("model requests get_summary, loop runs it, feeds result, model speaks", async () => {
    getSummary.mockResolvedValue({ herd: { totalAnimals: 5 } });
    sendMock
      .mockResolvedValueOnce(toolUseResponse("get_summary", {}))
      .mockResolvedValueOnce(textResponse("You have five animals."));

    const hi = makeHandlerInput();
    const res = await runAgent({ handlerInput: hi, utterance: "how's the farm" });

    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(res.speech).toBe("You have five animals.");

    // A toolResult for the requested tool was appended to the conversation and
    // carried back to the model on the follow-up Converse call.
    const finalMessages = sendMock.mock.calls[1][0].input.messages;
    const resultBlock = finalMessages
      .flatMap((m) => m.content)
      .map((c) => c.toolResult)
      .find(Boolean);
    expect(resultBlock.toolUseId).toBe("t1");
    expect(resultBlock.status).toBe("success");
  });

  test("default model id is used when env is unset", async () => {
    sendMock.mockResolvedValueOnce(textResponse("Hi."));
    const hi = makeHandlerInput();
    await runAgent({ handlerInput: hi, utterance: "hello" });
    expect(sendMock.mock.calls[0][0].input.modelId).toBe("us.amazon.nova-pro-v1:0");
  });

  test("empty utterance returns a help prompt without calling Bedrock", async () => {
    const hi = makeHandlerInput();
    const res = await runAgent({ handlerInput: hi, utterance: "   " });
    expect(sendMock).not.toHaveBeenCalled();
    expect(res.speech).toMatch(/help with your homestead/i);
  });
});

describe("runAgent — write flow (confirm-gated)", () => {
  test("record_death is captured as pendingAction and asks to confirm; NOT executed", async () => {
    sendMock.mockResolvedValueOnce(
      toolUseResponse("record_death", { animalRef: "Bessie" }),
    );

    const hi = makeHandlerInput();
    const res = await runAgent({ handlerInput: hi, utterance: "bessie died" });

    expect(recordDeath).not.toHaveBeenCalled();
    expect(res.speech).toMatch(/Record the death of Bessie\. Should I do that\?/);
    expect(res.reprompt).toBeTruthy();

    const pending = hi.attributesManager.getSessionAttributes()[PENDING_ACTION_KEY];
    expect(pending).toEqual({
      name: "record_death",
      args: { animalRef: "Bessie" },
      phrase: "Record the death of Bessie",
    });
    // Loop broke after the first (write) iteration — only one Converse call.
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("runAgent — iteration cap", () => {
  test("stops after MAX_ITERATIONS of repeated tool_use and apologizes", async () => {
    getSummary.mockResolvedValue({ herd: { totalAnimals: 1 } });
    // Always ask for a read tool, never finishing — should cap at 3 calls.
    sendMock.mockResolvedValue(toolUseResponse("get_summary", {}));

    const hi = makeHandlerInput();
    const res = await runAgent({ handlerInput: hi, utterance: "loop forever" });

    expect(sendMock).toHaveBeenCalledTimes(3);
    // No spoken text was ever produced -> graceful "couldn't find that".
    expect(res.speech).toMatch(/couldn't find that/i);
  });
});

describe("runAgent — errors", () => {
  test("Bedrock failure maps to a spoken apology, never throws", async () => {
    sendMock.mockRejectedValueOnce(new Error("bedrock down"));
    const hi = makeHandlerInput();
    const res = await runAgent({ handlerInput: hi, utterance: "anything" });
    expect(res.speech).toMatch(/having trouble/i);
    expect(res.linkAccount).toBe(false);
  });

  test("auth error from a tool prompts account linking", async () => {
    getSummary.mockRejectedValueOnce(new MissingTokenError());
    sendMock.mockResolvedValueOnce(toolUseResponse("get_summary", {}));
    const hi = makeHandlerInput();
    const res = await runAgent({ handlerInput: hi, utterance: "summary please" });
    expect(res.linkAccount).toBe(true);
    expect(res.speech).toMatch(/link your Homestead account/);
  });

  test("a 401 ApiError from a tool prompts account linking", async () => {
    getHerd.mockRejectedValueOnce(new ApiError(401, "Unauthorized"));
    sendMock.mockResolvedValueOnce(toolUseResponse("get_herd", {}));
    const hi = makeHandlerInput();
    const res = await runAgent({ handlerInput: hi, utterance: "count my animals" });
    expect(res.linkAccount).toBe(true);
  });
});

describe("runAgent — deps injection", () => {
  test("uses an injected client + api over the defaults", async () => {
    const injectedSend = jest.fn().mockResolvedValueOnce(textResponse("Injected."));
    const injectedApi = { getSummary: jest.fn() };
    const hi = makeHandlerInput();
    const res = await runAgent({
      handlerInput: hi,
      utterance: "hi",
      deps: { client: { send: injectedSend }, api: injectedApi },
    });
    expect(injectedSend).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
    expect(res.speech).toBe("Injected.");
  });
});
