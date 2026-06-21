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
} from "../lib/speech.mjs";
import { buildBirthFields, buildFeedFields } from "../lib/slots.mjs";

const SKILL_NAME = "Homestead";
const HELP_TEXT =
  "You can ask for your herd summary, ask how many animals you have, " +
  "record a birth, or record a feed purchase. What would you like to do?";

function getIntentName(handlerInput) {
  return handlerInput.requestEnvelope.request.intent?.name;
}

function isIntent(handlerInput, name) {
  const request = handlerInput.requestEnvelope.request;
  return request.type === "IntentRequest" && request.intent?.name === name;
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
    return handlerInput.responseBuilder
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
      return handlerInput.responseBuilder
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
      return handlerInput.responseBuilder
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

export const RecordBirthIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "RecordBirthIntent");
  },
  async handle(handlerInput) {
    const intent = handlerInput.requestEnvelope.request.intent;
    const built = buildBirthFields(intent);
    if (!built.ok) {
      return handlerInput.responseBuilder
        .speak(built.reprompt)
        .reprompt(built.reprompt)
        .getResponse();
    }

    try {
      const api = createApiClient(handlerInput);
      const result = await api.recordBirth(built.fields);
      return handlerInput.responseBuilder
        .speak(renderBirthConfirmation(result))
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

export const RecordFeedPurchaseIntentHandler = {
  canHandle(handlerInput) {
    return isIntent(handlerInput, "RecordFeedPurchaseIntent");
  },
  async handle(handlerInput) {
    const intent = handlerInput.requestEnvelope.request.intent;
    const built = buildFeedFields(intent);
    if (!built.ok) {
      return handlerInput.responseBuilder
        .speak(built.reprompt)
        .reprompt(built.reprompt)
        .getResponse();
    }

    try {
      const api = createApiClient(handlerInput);
      const purchase = await api.recordFeedPurchase(built.fields);
      return handlerInput.responseBuilder
        .speak(renderFeedConfirmation(purchase))
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
  RecordBirthIntentHandler,
  RecordFeedPurchaseIntentHandler,
  HelpIntentHandler,
  CancelAndStopIntentHandler,
  FallbackIntentHandler,
  SessionEndedRequestHandler,
];
