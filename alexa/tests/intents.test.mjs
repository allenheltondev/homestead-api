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
const recordFeedUsage = jest.fn();
const getFeedInventory = jest.fn();
const recordHealthExpense = jest.fn();
const getHealthStats = jest.fn();
const getMortality = jest.fn();
const getDigest = jest.fn();
const recordMilk = jest.fn();
const getMilkStats = jest.fn();
const getCareDue = jest.fn();
const completeCareTask = jest.fn();
const getUpcomingDue = jest.fn();
const getPnl = jest.fn();

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
    recordFeedUsage,
    getFeedInventory,
    recordHealthExpense,
    getHealthStats,
    getMortality,
    getDigest,
    recordMilk,
    getMilkStats,
    getCareDue,
    completeCareTask,
    getUpcomingDue,
    getPnl,
  }),
  ApiError,
  MissingTokenError,
  tokenFromRequest: () => "tok",
}));

// The agent-fallback handlers (CatchAll / Fallback) delegate to runAgent, which
// in turn talks to Bedrock. Mock it here so this suite stays focused on the
// structured intents and never reaches the network. The dedicated
// agent.test.mjs / fallback-handlers.test.mjs suites cover the real loop.
const runAgent = jest.fn(() => ({ speech: "agent" }));
jest.unstable_mockModule("../lib/agent.mjs", () => ({
  runAgent,
  PENDING_ACTION_KEY: "pendingAction",
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
  LogFeedUsageIntentHandler,
  GetFeedInventoryIntentHandler,
  RecordHealthExpenseIntentHandler,
  GetHealthStatsIntentHandler,
  GetMortalityIntentHandler,
  GetWeeklyDigestIntentHandler,
  LogMilkIntentHandler,
  GetMilkStatsIntentHandler,
  GetCareDueIntentHandler,
  CompleteCareTaskIntentHandler,
  GetUpcomingDueIntentHandler,
  GetPnlIntentHandler,
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
  test("fallback routes into the AI agent", () => {
    const hi = handlerInput(intentRequest("AMAZON.FallbackIntent"));
    FallbackIntentHandler.handle(hi);
    expect(runAgent).toHaveBeenCalledWith({
      handlerInput: hi,
      utterance: undefined,
    });
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

  test("GetEggCost passes an optional flock filter through", async () => {
    getEggCost.mockResolvedValue({ costPerDozen: 2 });
    await GetEggCostIntentHandler.handle(
      handlerInput(
        intentRequest("GetEggCostIntent", { flock: { value: "north coop" } }),
      ),
    );
    expect(getEggCost).toHaveBeenCalledWith({ flock: "north coop" });
  });
});

describe("RecordHealthExpenseIntent (dialog-delegated write)", () => {
  test("delegates while the dialog is incomplete", async () => {
    const res = await RecordHealthExpenseIntentHandler.handle(
      handlerInput(
        intentRequest("RecordHealthExpenseIntent", {}, "IN_PROGRESS"),
      ),
    );
    expect(res.delegated).toBe(true);
    expect(recordHealthExpense).not.toHaveBeenCalled();
  });

  test("posts category + cost when COMPLETED and confirms", async () => {
    recordHealthExpense.mockResolvedValue({ category: "vet", cost: 60 });
    const res = await RecordHealthExpenseIntentHandler.handle(
      handlerInput(
        intentRequest("RecordHealthExpenseIntent", {
          category: { value: "vet" },
          cost: { value: "60" },
        }),
        { apl: true },
      ),
    );
    expect(recordHealthExpense).toHaveBeenCalledWith({
      category: "vet",
      cost: 60,
    });
    expect(res.delegated).toBe(false);
    expect(res.speech).toContain("60 dollars");
    expect(res.speech).toContain("vet expense");
    // Confirmation screen on APL devices.
    expect(res.directives).toHaveLength(1);
  });

  test("surfaces auth errors on COMPLETED", async () => {
    recordHealthExpense.mockRejectedValue(new MissingTokenError());
    const res = await RecordHealthExpenseIntentHandler.handle(
      handlerInput(
        intentRequest("RecordHealthExpenseIntent", {
          category: { value: "medicine" },
          cost: { value: "25" },
        }),
      ),
    );
    expect(res.linkAccount).toBe(true);
  });
});

describe("GetHealthStatsIntent", () => {
  test("calls getHealthStats and speaks the spend", async () => {
    getHealthStats.mockResolvedValue({
      total: 150,
      periodLabel: "this month",
    });
    const res = await GetHealthStatsIntentHandler.handle(
      handlerInput(
        intentRequest("GetHealthStatsIntent", { period: { value: "this month" } }),
      ),
    );
    expect(getHealthStats).toHaveBeenCalledWith({ period: "this month" });
    expect(res.speech).toContain("150 dollars on animal health this month");
  });

  test("prompts to link account on a 401", async () => {
    getHealthStats.mockRejectedValue(new ApiError(401, "Unauthorized"));
    const res = await GetHealthStatsIntentHandler.handle(
      handlerInput(intentRequest("GetHealthStatsIntent")),
    );
    expect(res.linkAccount).toBe(true);
  });
});

describe("GetMortalityIntent", () => {
  test("calls getMortality and speaks the loss rate", async () => {
    getMortality.mockResolvedValue({
      deaths: 2,
      lossRate: 0.04,
      periodLabel: "this year",
    });
    const res = await GetMortalityIntentHandler.handle(
      handlerInput(
        intentRequest("GetMortalityIntent", { period: { value: "this year" } }),
      ),
    );
    expect(getMortality).toHaveBeenCalledWith({ period: "this year" });
    expect(res.speech).toContain("2 animals this year");
    expect(res.speech).toContain("4 percent loss rate");
  });

  test("speaks a generic error on a 500", async () => {
    getMortality.mockRejectedValue(new ApiError(500, "boom"));
    const res = await GetMortalityIntentHandler.handle(
      handlerInput(intentRequest("GetMortalityIntent")),
    );
    expect(res.linkAccount).toBe(false);
    expect(res.speech).toMatch(/couldn't get your mortality stats/);
  });
});

describe("GetWeeklyDigestIntent", () => {
  test("calls getDigest and speaks the lines", async () => {
    getDigest.mockResolvedValue({
      title: "Your weekly digest",
      lines: ["You collected 84 eggs.", "You lost no animals."],
    });
    const res = await GetWeeklyDigestIntentHandler.handle(
      handlerInput(intentRequest("GetWeeklyDigestIntent")),
    );
    expect(getDigest).toHaveBeenCalledTimes(1);
    expect(res.speech).toContain("You collected 84 eggs.");
    expect(res.speech).toContain("You lost no animals.");
  });

  test("prompts to link account on MissingTokenError", async () => {
    getDigest.mockRejectedValue(new MissingTokenError());
    const res = await GetWeeklyDigestIntentHandler.handle(
      handlerInput(intentRequest("GetWeeklyDigestIntent")),
    );
    expect(res.linkAccount).toBe(true);
  });
});

describe("LogFeedUsageIntent (dialog-delegated write)", () => {
  test("delegates while the dialog is incomplete", async () => {
    const res = await LogFeedUsageIntentHandler.handle(
      handlerInput(intentRequest("LogFeedUsageIntent", {}, "IN_PROGRESS")),
    );
    expect(res.delegated).toBe(true);
    expect(recordFeedUsage).not.toHaveBeenCalled();
  });

  test("posts lbs + feedType when COMPLETED and confirms", async () => {
    recordFeedUsage.mockResolvedValue({ lbs: 25, feedType: "chicken" });
    const res = await LogFeedUsageIntentHandler.handle(
      handlerInput(
        intentRequest("LogFeedUsageIntent", {
          feedType: { value: "chicken" },
          amount: { value: "25" },
        }),
        { apl: true },
      ),
    );
    expect(recordFeedUsage).toHaveBeenCalledWith({
      feedType: "chicken",
      lbs: 25,
    });
    expect(res.delegated).toBe(false);
    expect(res.speech).toContain("25 pounds of chicken feed");
    // Confirmation screen on APL devices.
    expect(res.directives).toHaveLength(1);
  });

  test("surfaces auth errors on COMPLETED", async () => {
    recordFeedUsage.mockRejectedValue(new MissingTokenError());
    const res = await LogFeedUsageIntentHandler.handle(
      handlerInput(
        intentRequest("LogFeedUsageIntent", {
          feedType: { value: "chicken" },
          amount: { value: "10" },
        }),
      ),
    );
    expect(res.linkAccount).toBe(true);
  });
});

describe("GetFeedInventoryIntent + APL gating", () => {
  test("speaks inventory and renders APL on capable devices", async () => {
    getFeedInventory.mockResolvedValue({
      feedType: "chicken",
      onHandLbs: 120,
      daysRemaining: 12,
      runOutDate: "2026-07-03",
    });
    const res = await GetFeedInventoryIntentHandler.handle(
      handlerInput(
        intentRequest("GetFeedInventoryIntent", { feedType: { value: "chicken" } }),
        { apl: true },
      ),
    );
    expect(getFeedInventory).toHaveBeenCalledWith("chicken");
    expect(res.speech).toContain("120 pounds of chicken feed left");
    expect(res.directives).toHaveLength(1);
    expect(res.directives[0].type).toBe(
      "Alexa.Presentation.APL.RenderDocument",
    );
  });

  test("stays voice-only on headless devices", async () => {
    getFeedInventory.mockResolvedValue({ items: [] });
    const res = await GetFeedInventoryIntentHandler.handle(
      handlerInput(intentRequest("GetFeedInventoryIntent"), { apl: false }),
    );
    expect(getFeedInventory).toHaveBeenCalledWith(undefined);
    expect(res.directives).toHaveLength(0);
    expect(res.speech).toBeTruthy();
  });

  test("prompts to link account on a 401", async () => {
    getFeedInventory.mockRejectedValue(new ApiError(401, "Unauthorized"));
    const res = await GetFeedInventoryIntentHandler.handle(
      handlerInput(intentRequest("GetFeedInventoryIntent")),
    );
    expect(res.linkAccount).toBe(true);
  });
});

describe("LogMilkIntent (dialog-delegated write)", () => {
  test("delegates while the dialog is incomplete", async () => {
    const res = await LogMilkIntentHandler.handle(
      handlerInput(intentRequest("LogMilkIntent", {}, "IN_PROGRESS")),
    );
    expect(res.delegated).toBe(true);
    expect(recordMilk).not.toHaveBeenCalled();
  });

  test("posts volume + unit when COMPLETED and confirms", async () => {
    recordMilk.mockResolvedValue({ volume: 2, unit: "gal", animal: "Daisy" });
    const res = await LogMilkIntentHandler.handle(
      handlerInput(
        intentRequest("LogMilkIntent", {
          volume: { value: "2" },
          animal: { value: "Daisy" },
        }),
        { apl: true },
      ),
    );
    expect(recordMilk).toHaveBeenCalledWith({
      volume: 2,
      unit: "gal",
      animal: "Daisy",
    });
    expect(res.delegated).toBe(false);
    expect(res.speech).toContain("2 gallons of milk from Daisy");
    expect(res.directives).toHaveLength(1);
  });

  test("surfaces auth errors on COMPLETED", async () => {
    recordMilk.mockRejectedValue(new MissingTokenError());
    const res = await LogMilkIntentHandler.handle(
      handlerInput(
        intentRequest("LogMilkIntent", { volume: { value: "1" } }),
      ),
    );
    expect(res.linkAccount).toBe(true);
  });
});

describe("GetMilkStatsIntent", () => {
  test("calls getMilkStats and speaks the production", async () => {
    getMilkStats.mockResolvedValue({
      total: 14,
      unit: "gal",
      perDay: 0.5,
      periodLabel: "this month",
    });
    const res = await GetMilkStatsIntentHandler.handle(
      handlerInput(
        intentRequest("GetMilkStatsIntent", { period: { value: "this month" } }),
      ),
    );
    expect(getMilkStats).toHaveBeenCalledWith({ period: "this month" });
    expect(res.speech).toContain("14 gallons of milk this month");
  });

  test("prompts to link account on a 401", async () => {
    getMilkStats.mockRejectedValue(new ApiError(401, "Unauthorized"));
    const res = await GetMilkStatsIntentHandler.handle(
      handlerInput(intentRequest("GetMilkStatsIntent")),
    );
    expect(res.linkAccount).toBe(true);
  });
});

describe("GetCareDueIntent", () => {
  test("calls getCareDue with the withinDays slot and speaks the tasks", async () => {
    getCareDue.mockResolvedValue({
      tasks: [{ name: "deworm the goats", dueDate: "2026-06-26" }],
    });
    const res = await GetCareDueIntentHandler.handle(
      handlerInput(
        intentRequest("GetCareDueIntent", { withinDays: { value: "7" } }),
      ),
    );
    expect(getCareDue).toHaveBeenCalledWith(7);
    expect(res.speech).toContain("deworm the goats");
  });

  test("omits the window when no slot is given", async () => {
    getCareDue.mockResolvedValue({ tasks: [] });
    await GetCareDueIntentHandler.handle(
      handlerInput(intentRequest("GetCareDueIntent")),
    );
    expect(getCareDue).toHaveBeenCalledWith(undefined);
  });
});

describe("CompleteCareTaskIntent (dialog-delegated write)", () => {
  test("delegates while the dialog is incomplete", async () => {
    const res = await CompleteCareTaskIntentHandler.handle(
      handlerInput(intentRequest("CompleteCareTaskIntent", {}, "IN_PROGRESS")),
    );
    expect(res.delegated).toBe(true);
    expect(completeCareTask).not.toHaveBeenCalled();
  });

  test("completes the named task when COMPLETED and confirms", async () => {
    completeCareTask.mockResolvedValue(null);
    const res = await CompleteCareTaskIntentHandler.handle(
      handlerInput(
        intentRequest("CompleteCareTaskIntent", {
          task: { value: "deworm the goats" },
        }),
      ),
    );
    expect(completeCareTask).toHaveBeenCalledWith("deworm the goats");
    expect(res.delegated).toBe(false);
    expect(res.speech).toContain("deworm the goats");
  });

  test("surfaces auth errors on COMPLETED", async () => {
    completeCareTask.mockRejectedValue(new MissingTokenError());
    const res = await CompleteCareTaskIntentHandler.handle(
      handlerInput(
        intentRequest("CompleteCareTaskIntent", { task: { value: "trim hooves" } }),
      ),
    );
    expect(res.linkAccount).toBe(true);
  });
});

describe("GetUpcomingDueIntent", () => {
  test("calls getUpcomingDue and speaks births + hatches", async () => {
    getUpcomingDue.mockResolvedValue({
      breeding: { upcoming: [{ dam: "Daisy", event: "kidding", dueDate: "2026-07-01" }] },
      incubation: { batches: [{ species: "chicken", eggCount: 12, hatchDate: "2026-06-30" }] },
    });
    const res = await GetUpcomingDueIntentHandler.handle(
      handlerInput(intentRequest("GetUpcomingDueIntent")),
    );
    expect(getUpcomingDue).toHaveBeenCalledWith(undefined);
    expect(res.speech).toContain("Daisy");
    expect(res.speech).toContain("In the incubator");
  });

  test("speaks a generic error on a 500", async () => {
    getUpcomingDue.mockRejectedValue(new ApiError(500, "boom"));
    const res = await GetUpcomingDueIntentHandler.handle(
      handlerInput(intentRequest("GetUpcomingDueIntent")),
    );
    expect(res.linkAccount).toBe(false);
    expect(res.speech).toMatch(/couldn't check what's coming due/);
  });
});

describe("GetPnlIntent", () => {
  test("calls getPnl and speaks the verdict", async () => {
    getPnl.mockResolvedValue({
      income: 400,
      expenses: 250,
      net: 150,
      periodLabel: "this month",
    });
    const res = await GetPnlIntentHandler.handle(
      handlerInput(
        intentRequest("GetPnlIntent", { period: { value: "this month" } }),
      ),
    );
    expect(getPnl).toHaveBeenCalledWith({ period: "this month" });
    expect(res.speech).toContain("in the black by 150 dollars");
  });

  test("prompts to link account on MissingTokenError", async () => {
    getPnl.mockRejectedValue(new MissingTokenError());
    const res = await GetPnlIntentHandler.handle(
      handlerInput(intentRequest("GetPnlIntent")),
    );
    expect(res.linkAccount).toBe(true);
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
