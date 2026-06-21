// ask-sdk RequestHandlers for the Homestead skill. Each intent handler maps
// an Alexa intent to one API call (via lib/api.mjs) and renders a spoken
// response (via lib/speech.mjs). The handlers stay thin: build fields, call
// the API, speak the result, and translate auth/error states into prompts.

import {
  createApiClient,
  ApiError,
  MissingTokenError,
} from "../lib/api.mjs";
import {
  renderSummary,
  renderHerdCount,
  renderBirthConfirmation,
  renderFeedConfirmation,
  renderEggLogged,
  renderEggStats,
  renderEggCost,
  renderFeedUsageLogged,
  renderFeedInventory,
  renderHealthExpenseLogged,
  renderHealthStats,
  renderMortality,
  renderDigest,
} from "../lib/speech.mjs";
import {
  buildBirthFields,
  buildFeedFields,
  buildEggFields,
  buildDeathFields,
  buildMoveFields,
  buildPeriodQuery,
  buildEggCostQuery,
  buildFeedUsageFields,
  buildHealthExpenseFields,
  slotValue,
} from "../lib/slots.mjs";
import {
  addHomeScreen,
  addHerdSummaryScreen,
  addHerdCountScreen,
  addConfirmationScreen,
  addEggStatsScreen,
  addEggCostScreen,
  addFeedInventoryScreen,
} from "../lib/apl.mjs";

const SKILL_NAME = "Homestead";
const HELP_TEXT =
  "You can ask for your herd summary, ask how many animals you have, " +
  "log a feed purchase, log an egg collection, record a birth or death, " +
  "move animals, log feed you've fed out, ask how much feed you have left, " +
  "ask about your egg stats and cost, record a vet or health expense, " +
  "ask how much you've spent on health, ask about your loss rate, " +
  "or ask for your weekly homestead digest. " +
  "What would you like to do?";

function getIntentName(handlerInput) {
  return handlerInput.requestEnvelope.request.intent?.name;
}

function isIntent(handlerInput, name) {
  const request = handlerInput.requestEnvelope.request;
  return request.type === "IntentRequest" && request.intent?.name === name;
}

// True while Alexa is still collecting/confirming slots for a dialog-managed
// intent. Until the dialog reports COMPLETED we hand control back to Alexa
// (auto-delegation) rather than calling the API.
function dialogIncomplete(handlerInput) {
  return handlerInput.requestEnvelope.request.dialogState !== "COMPLETED";
}

// Returns the auto-delegate directive response Alexa drives the multi-turn
// dialog with.
function delegate(handlerInput) {
  return handlerInput.responseBuilder.addDelegateDirective().getResponse();
}

// Speaks a "please link your account" prompt with a LinkAccount card. Used
// whenever the API call fails because there's no (or an invalid) token.
function needsLinking(handlerInput) {
  return handlerInput.responseBuilder
    .speak(
      "Please link your Homestead account in the Alexa app to use this skill.",
    )
    .withLinkAccountCard()
    .getResponse();
}

// Centralized error -> speech translation shared by every API-backed intent.
function speakApiError(handlerInput, err, fallback) {
  if (err instanceof MissingTokenError) return needsLinking(handlerInput);
  if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
    return needsLinking(handlerInput);
  }
  return handlerInput.responseBuilder.speak(fallback).getResponse();
}

export const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === "LaunchRequest";
  },
  handle(handlerInput) {
    return addHomeScreen(handlerInput)
      .speak(`Welcome to ${SKILL_NAME}. ${HELP_TEXT}`)
      .reprompt(HELP_TEXT)
      .getResponse();
  },
};

export const GetHerdSummaryIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "GetHerdSummaryIntent");
  },
  async handle(handlerInput) {
    try {
      const api = createApiClient(handlerInput);
      const summary = await api.getSummary();
      return addHerdSummaryScreen(handlerInput, summary)
        .speak(renderSummary(summary))
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't get your homestead summary right now.",
      );
    }
  },
};

export const GetHerdCountIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "GetHerdCountIntent");
  },
  async handle(handlerInput) {
    try {
      const api = createApiClient(handlerInput);
      const herd = await api.getHerd();
      return addHerdCountScreen(handlerInput, herd)
        .speak(renderHerdCount(herd))
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't get your herd count right now.",
      );
    }
  },
};

export const LogFeedPurchaseIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "LogFeedPurchaseIntent");
  },
  async handle(handlerInput) {
    if (dialogIncomplete(handlerInput)) return delegate(handlerInput);

    const intent = handlerInput.requestEnvelope.request.intent;
    const fields = buildFeedFields(intent);
    try {
      const api = createApiClient(handlerInput);
      const purchase = await api.recordFeedPurchase(fields);
      const text = renderFeedConfirmation(purchase ?? fields);
      return addConfirmationScreen(
        handlerInput,
        "Feed purchase recorded",
        text,
      )
        .speak(text)
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't record that feed purchase right now.",
      );
    }
  },
};

export const LogEggCollectionIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "LogEggCollectionIntent");
  },
  async handle(handlerInput) {
    if (dialogIncomplete(handlerInput)) return delegate(handlerInput);

    const intent = handlerInput.requestEnvelope.request.intent;
    const fields = buildEggFields(intent);
    try {
      const api = createApiClient(handlerInput);
      const result = await api.recordEggCollection(fields);
      return handlerInput.responseBuilder
        .speak(renderEggLogged(result ?? fields))
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't log that egg collection right now.",
      );
    }
  },
};

export const RecordBirthIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "RecordBirthIntent");
  },
  async handle(handlerInput) {
    if (dialogIncomplete(handlerInput)) return delegate(handlerInput);

    const intent = handlerInput.requestEnvelope.request.intent;
    const fields = buildBirthFields(intent);
    try {
      const api = createApiClient(handlerInput);
      const result = await api.recordBirth(fields);
      const text = renderBirthConfirmation(result);
      return addConfirmationScreen(handlerInput, "Birth recorded", text)
        .speak(text)
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't record that birth right now.",
      );
    }
  },
};

export const RecordDeathIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "RecordDeathIntent");
  },
  async handle(handlerInput) {
    if (dialogIncomplete(handlerInput)) return delegate(handlerInput);

    const intent = handlerInput.requestEnvelope.request.intent;
    const fields = buildDeathFields(intent);
    try {
      const api = createApiClient(handlerInput);
      await api.recordDeath(fields);
      return handlerInput.responseBuilder
        .speak("Got it. I recorded that death.")
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't record that death right now.",
      );
    }
  },
};

export const MoveAnimalsIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "MoveAnimalsIntent");
  },
  async handle(handlerInput) {
    if (dialogIncomplete(handlerInput)) return delegate(handlerInput);

    const intent = handlerInput.requestEnvelope.request.intent;
    const fields = buildMoveFields(intent);
    try {
      const api = createApiClient(handlerInput);
      await api.moveAnimals(fields);
      return handlerInput.responseBuilder
        .speak(
          `Got it. I moved ${fields.group ?? "the animals"} to ${
            fields.pasture ?? "the pasture"
          }.`,
        )
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't move those animals right now.",
      );
    }
  },
};

export const GetEggStatsIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "GetEggStatsIntent");
  },
  async handle(handlerInput) {
    const intent = handlerInput.requestEnvelope.request.intent;
    try {
      const api = createApiClient(handlerInput);
      const stats = await api.getEggStats(buildPeriodQuery(intent));
      return addEggStatsScreen(handlerInput, stats)
        .speak(renderEggStats(stats))
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't get your egg stats right now.",
      );
    }
  },
};

export const GetEggCostIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "GetEggCostIntent");
  },
  async handle(handlerInput) {
    const intent = handlerInput.requestEnvelope.request.intent;
    try {
      const api = createApiClient(handlerInput);
      const cost = await api.getEggCost(buildEggCostQuery(intent));
      return addEggCostScreen(handlerInput, cost)
        .speak(renderEggCost(cost))
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't get your egg cost right now.",
      );
    }
  },
};

export const LogFeedUsageIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "LogFeedUsageIntent");
  },
  async handle(handlerInput) {
    if (dialogIncomplete(handlerInput)) return delegate(handlerInput);

    const intent = handlerInput.requestEnvelope.request.intent;
    const fields = buildFeedUsageFields(intent);
    try {
      const api = createApiClient(handlerInput);
      const result = await api.recordFeedUsage(fields);
      const text = renderFeedUsageLogged(result ?? fields);
      return addConfirmationScreen(handlerInput, "Feed usage logged", text)
        .speak(text)
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't log that feed usage right now.",
      );
    }
  },
};

export const GetFeedInventoryIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "GetFeedInventoryIntent");
  },
  async handle(handlerInput) {
    const intent = handlerInput.requestEnvelope.request.intent;
    const feedType = slotValue(intent, "feedType");
    try {
      const api = createApiClient(handlerInput);
      const inventory = await api.getFeedInventory(feedType);
      return addFeedInventoryScreen(handlerInput, inventory)
        .speak(renderFeedInventory(inventory))
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't get your feed inventory right now.",
      );
    }
  },
};

export const RecordHealthExpenseIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "RecordHealthExpenseIntent");
  },
  async handle(handlerInput) {
    if (dialogIncomplete(handlerInput)) return delegate(handlerInput);

    const intent = handlerInput.requestEnvelope.request.intent;
    const fields = buildHealthExpenseFields(intent);
    try {
      const api = createApiClient(handlerInput);
      const result = await api.recordHealthExpense(fields);
      const text = renderHealthExpenseLogged(result ?? fields);
      return addConfirmationScreen(handlerInput, "Health expense recorded", text)
        .speak(text)
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't record that health expense right now.",
      );
    }
  },
};

export const GetHealthStatsIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "GetHealthStatsIntent");
  },
  async handle(handlerInput) {
    const intent = handlerInput.requestEnvelope.request.intent;
    try {
      const api = createApiClient(handlerInput);
      const stats = await api.getHealthStats(buildPeriodQuery(intent));
      return handlerInput.responseBuilder
        .speak(renderHealthStats(stats))
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't get your health spending right now.",
      );
    }
  },
};

export const GetMortalityIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "GetMortalityIntent");
  },
  async handle(handlerInput) {
    const intent = handlerInput.requestEnvelope.request.intent;
    try {
      const api = createApiClient(handlerInput);
      const stats = await api.getMortality(buildPeriodQuery(intent));
      return handlerInput.responseBuilder
        .speak(renderMortality(stats))
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't get your mortality stats right now.",
      );
    }
  },
};

export const GetWeeklyDigestIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "GetWeeklyDigestIntent");
  },
  async handle(handlerInput) {
    try {
      const api = createApiClient(handlerInput);
      const digest = await api.getDigest();
      return handlerInput.responseBuilder
        .speak(renderDigest(digest))
        .getResponse();
    } catch (err) {
      return speakApiError(
        handlerInput,
        err,
        "Sorry, I couldn't put together your homestead digest right now.",
      );
    }
  },
};

export const HelpIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "AMAZON.HelpIntent");
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(HELP_TEXT)
      .reprompt(HELP_TEXT)
      .getResponse();
  },
};

export const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return (
      isIntent(handlerInput, "AMAZON.CancelIntent") ||
      isIntent(handlerInput, "AMAZON.StopIntent")
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.speak("Goodbye.").getResponse();
  },
};

export const FallbackIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "AMAZON.FallbackIntent");
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(`Sorry, I didn't catch that. ${HELP_TEXT}`)
      .reprompt(HELP_TEXT)
      .getResponse();
  },
};

export const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === "SessionEndedRequest";
  },
  handle(handlerInput) {
    // Nothing to clean up; just acknowledge so the session closes cleanly.
    return handlerInput.responseBuilder.getResponse();
  },
};

// Catch-all error handler registered on the skill. Logs and speaks a generic
// retry prompt rather than leaking an internal failure to the user.
export const GenericErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.error("Alexa skill error", {
      intent: getIntentName(handlerInput),
      message: error?.message,
    });
    return handlerInput.responseBuilder
      .speak("Sorry, something went wrong. Please try again.")
      .reprompt("Please try again.")
      .getResponse();
  },
};

export const handlers = [
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
  HelpIntentHandler,
  CancelAndStopIntentHandler,
  FallbackIntentHandler,
  SessionEndedRequestHandler,
];
