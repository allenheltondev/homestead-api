// AI-agent fallback for the Homestead skill. When no structured intent matches
// a phrase, handlers route the raw utterance here. We drive an Amazon Nova Pro
// model on Amazon Bedrock (via the Converse API's tool-use protocol) that has
// the homestead API operations as tools, so the skill can act on free-form
// requests instead of saying "I didn't catch that".
//
// This is NOT the Anthropic SDK — it speaks the Bedrock Converse shape:
//   - request:  { modelId, system, messages, toolConfig, inferenceConfig }
//   - messages: { role, content: [ {text}|{toolUse}|{toolResult} ] }
//   - a tool:   { toolSpec: { name, description, inputSchema: { json } } }
//   - response: response.output.message (the assistant turn);
//               response.stopReason === "tool_use" to request tools.
//
// READ tools run inline and feed results back to the model. WRITE tools are
// confirm-gated: the FIRST requested write is captured as a pendingAction,
// stashed in Alexa session attributes, and read back to the user for a spoken
// yes/no before anything mutates (executed by the Yes handler in
// handlers/intents.mjs).

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { createApiClient, ApiError, MissingTokenError } from "./api.mjs";
import { TOOL_SPECS, REGISTRY } from "./tools.mjs";

// Cross-region inference profile id for Nova Pro. Overridable via the
// BedrockModelId template parameter (see template.yaml).
const DEFAULT_MODEL_ID = "us.amazon.nova-pro-v1:0";

// Cap on Converse round-trips so a misbehaving model can't loop forever.
const MAX_ITERATIONS = 3;

// Session-attribute key the pending write is stashed under between turns.
export const PENDING_ACTION_KEY = "pendingAction";

const SYSTEM_PROMPT =
  "You are Homestead, a voice assistant for a small farm. The user speaks to " +
  "you through an Alexa device, so keep every answer short, plain, and easy to " +
  "say out loud — one or two sentences, no markdown, no lists, no emoji. " +
  "Use the provided tools to read homestead data or to record changes; do not " +
  "make up numbers. When the user wants to record, log, add, or change data, " +
  "call the matching write tool with your best understanding of the details — " +
  "you are proposing the change, not performing it, and the system will ask " +
  "the user to confirm before saving. If a request is unrelated to the " +
  "homestead, say you can only help with the farm.";

// Lazily build a Bedrock client bound to the Lambda's region. Injectable for
// tests via runAgent's `deps`.
function defaultClientFactory() {
  return new BedrockRuntimeClient({});
}

// Speaks the "please link your account" prompt with a LinkAccount card. Mirrors
// the helper in handlers/intents.mjs so auth failures inside the agent surface
// the same way as the structured intents.
function needsLinking(handlerInput) {
  return handlerInput.responseBuilder
    .speak(
      "Please link your Homestead account in the Alexa app to use this skill.",
    )
    .withLinkAccountCard()
    .getResponse();
}

function isAuthError(err) {
  return (
    err instanceof MissingTokenError ||
    (err instanceof ApiError && (err.status === 401 || err.status === 403))
  );
}

// Pulls the spoken text out of an assistant message's content blocks.
function assistantText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks
    .map((b) => (typeof b?.text === "string" ? b.text : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
}

// Collects every { toolUse } block the model emitted on a turn.
function toolUses(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks.map((b) => b?.toolUse).filter(Boolean);
}

// Runs the agentic loop for one free-form utterance and returns a spoken Alexa
// response. Never throws to the user — every failure maps to a spoken apology
// or the account-linking prompt.
//
// deps lets tests inject a fake Bedrock client + api client; in production both
// default to the real implementations.
export async function runAgent({ handlerInput, utterance, deps = {} } = {}) {
  const text = typeof utterance === "string" ? utterance.trim() : "";
  if (!text) {
    return handlerInput.responseBuilder
      .speak(
        "I can help with your homestead. Try asking about your herd, your eggs, or your feed.",
      )
      .reprompt("What would you like to know?")
      .getResponse();
  }

  const api = deps.api ?? createApiClient(handlerInput);
  const modelId = process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID;

  let client;
  try {
    client = deps.client ?? defaultClientFactory();
  } catch {
    return apology(handlerInput);
  }

  const messages = [{ role: "user", content: [{ text }] }];
  let spoken = "";

  try {
    for (let i = 0; i < MAX_ITERATIONS; i += 1) {
      const response = await client.send(
        new ConverseCommand({
          modelId,
          system: [{ text: SYSTEM_PROMPT }],
          messages,
          toolConfig: { tools: TOOL_SPECS },
          inferenceConfig: { maxTokens: 512, temperature: 0 },
        }),
      );

      const message = response?.output?.message;
      // Record the assistant turn so the next Converse call has full context.
      if (message) messages.push(message);

      if (response?.stopReason === "tool_use") {
        const requested = toolUses(message);
        const pending = await handleToolUses({
          requested,
          api,
          messages,
        });
        if (pending) {
          return confirmWrite(handlerInput, pending);
        }
        // All requested tools were reads; results are appended — loop again so
        // the model can read them and compose its answer.
        continue;
      }

      // end_turn (or anything that isn't a tool request): take the spoken text.
      spoken = assistantText(message);
      break;
    }
  } catch (err) {
    if (isAuthError(err)) return needsLinking(handlerInput);
    return apology(handlerInput);
  }

  if (!spoken) {
    return handlerInput.responseBuilder
      .speak("Sorry, I couldn't find that. Please try asking another way.")
      .reprompt("What would you like to know?")
      .getResponse();
  }

  return handlerInput.responseBuilder
    .speak(spoken)
    .reprompt("Is there anything else?")
    .getResponse();
}

// Executes the READ tools the model requested (appending toolResult blocks) and
// returns the FIRST write as a pendingAction (without executing it). Auth
// errors propagate so runAgent can prompt for linking.
async function handleToolUses({ requested, api, messages }) {
  const results = [];
  let pending = null;

  for (const use of requested) {
    const entry = REGISTRY[use.name];
    if (!entry) {
      results.push(toolResultBlock(use.toolUseId, { error: "unknown tool" }, "error"));
      continue;
    }

    if (entry.kind === "write") {
      // Capture only the FIRST write; ignore any others this turn.
      if (!pending) {
        pending = {
          name: use.name,
          args: use.input ?? {},
          phrase: entry.describe(use.input ?? {}),
        };
      }
      // Still answer the toolUse so the message history stays well-formed if we
      // ever continued, but we break out before sending it back.
      continue;
    }

    // READ: run inline and feed the JSON result back to the model.
    const data = await entry.run(use.input ?? {}, api);
    results.push(toolResultBlock(use.toolUseId, data ?? {}, "success"));
  }

  // If a write was requested we stop here — the caller will confirm it.
  if (pending) return pending;

  if (results.length > 0) {
    messages.push({ role: "user", content: results });
  }
  return null;
}

function toolResultBlock(toolUseId, json, status) {
  return {
    toolResult: {
      toolUseId,
      content: [{ json }],
      status,
    },
  };
}

// Stashes the pending write in session attributes and asks the user to confirm
// out loud, keeping the session open with a reprompt.
function confirmWrite(handlerInput, pending) {
  const attributes = handlerInput.attributesManager.getSessionAttributes() || {};
  attributes[PENDING_ACTION_KEY] = pending;
  handlerInput.attributesManager.setSessionAttributes(attributes);

  const phrase = pending.phrase || "make that change";
  return handlerInput.responseBuilder
    .speak(`${phrase}. Should I do that?`)
    .reprompt(`${phrase}. Should I do that?`)
    .getResponse();
}

function apology(handlerInput) {
  return handlerInput.responseBuilder
    .speak("Sorry, I'm having trouble with that right now. Please try again.")
    .reprompt("Please try again.")
    .getResponse();
}

export const __testables = {
  SYSTEM_PROMPT,
  MAX_ITERATIONS,
  assistantText,
  toolUses,
  isAuthError,
};
