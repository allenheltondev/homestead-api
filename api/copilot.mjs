// Read-only "farm copilot" endpoint (POST /copilot). Answers free-form
// questions across all homestead data by driving an Amazon Bedrock Nova Pro
// model through the Converse API's tool-use protocol over the in-process
// read-only domain/stats aggregations (see api/copilot/tools.mjs).
//
// This is its own esbuild entry point / Lambda (see template.yaml
// CopilotFunction) so it ships the Bedrock client without pulling in the full
// route bundle. It is Cognito-authed via the API's default authorizer.
//
// The Converse shape (NOT the Anthropic SDK):
//   request:  { modelId, system, messages, toolConfig, inferenceConfig }
//   messages: { role, content: [ {text}|{toolUse}|{toolResult} ] }
//   a tool:   { toolSpec: { name, description, inputSchema: { json } } }
//   response: response.output.message; response.stopReason === "tool_use" to
//             request tools.
//
// Every tool is READ-ONLY, so this endpoint can never mutate homestead data.

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { TOOL_SPECS, REGISTRY } from "./copilot/tools.mjs";
import { jsonResponse } from "./services/http.mjs";
import { parseBody } from "./services/http.mjs";
import { ApiError, BadRequestError } from "./services/errors.mjs";
import { logger } from "./services/logger.mjs";

// Cross-region inference profile id for Nova Pro. Overridable via the
// BedrockModelId template parameter (BEDROCK_MODEL_ID env).
const DEFAULT_MODEL_ID = "us.amazon.nova-pro-v1:0";

// Cap on Converse round-trips so a misbehaving model can't loop forever.
const MAX_ITERATIONS = 6;

const SYSTEM_PROMPT =
  "You are a concise, read-only homestead copilot. You answer questions about a "
  + "small farm's animals, eggs, milk, feed, health spending, mortality, garden, "
  + "produce listings, care tasks, and finances. Always ground every answer in "
  + "the numbers returned by the tools and name the specific figures (e.g. dozens, "
  + "dollars, pounds, head count) -- never invent or estimate data the tools did "
  + "not return. Call the tools you need before answering. You can only READ data; "
  + "you can never change, add, or delete anything, so never claim to have done so. "
  + "If a question is unrelated to the homestead, say you can only help with the "
  + "farm. Keep answers short and plain.";

// Lazily build a Bedrock client. Injectable for tests via runCopilot's `deps`.
function defaultClientFactory() {
  return new BedrockRuntimeClient({});
}

// Pulls assistant text out of a message's content blocks.
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

function toolResultBlock(toolUseId, json, status) {
  return {
    toolResult: {
      toolUseId,
      content: [{ json }],
      status,
    },
  };
}

// Validates the request body into a Converse `messages` array. Each message is
// { role: 'user'|'assistant', content: string }; we map it to the Converse
// content-block shape ([{ text }]). Throws BadRequestError (-> 400) on a bad
// shape so a malformed body never becomes a 500.
export function buildMessages(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new BadRequestError("messages must be a non-empty array");
  }
  return messages.map((m, i) => {
    if (typeof m !== "object" || m === null) {
      throw new BadRequestError(`messages[${i}] must be an object`);
    }
    if (m.role !== "user" && m.role !== "assistant") {
      throw new BadRequestError(`messages[${i}].role must be 'user' or 'assistant'`);
    }
    if (typeof m.content !== "string" || m.content.trim() === "") {
      throw new BadRequestError(`messages[${i}].content must be a non-empty string`);
    }
    return { role: m.role, content: [{ text: m.content }] };
  });
}

// Executes the tools the model requested, appending a toolResult user turn.
// Unknown tools and handler errors are returned as error toolResults so the
// model can recover instead of failing the whole request. Records each
// executed tool name in `toolsUsed`.
async function handleToolUses({ requested, messages, toolsUsed }) {
  const results = [];
  for (const use of requested) {
    toolsUsed.push(use.name);
    const handler = REGISTRY[use.name];
    if (!handler) {
      results.push(toolResultBlock(use.toolUseId, { error: "unknown tool" }, "error"));
      continue;
    }
    try {
      const data = await handler(use.input ?? {});
      results.push(toolResultBlock(use.toolUseId, data ?? {}, "success"));
    } catch (err) {
      logger.warn("copilot tool failed", { tool: use.name, error: err?.message });
      results.push(toolResultBlock(use.toolUseId, { error: err?.message ?? "tool failed" }, "error"));
    }
  }
  if (results.length > 0) {
    messages.push({ role: "user", content: results });
  }
}

// Runs the Converse tool-use loop for a validated `messages` array and returns
// { reply, toolsUsed }. deps lets tests inject a fake Bedrock client.
export async function runCopilot({ messages, deps = {} } = {}) {
  const client = deps.client ?? defaultClientFactory();
  const modelId = process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID;
  const today = new Date().toISOString().slice(0, 10);
  const system = [{ text: `${SYSTEM_PROMPT} Today's date is ${today}.` }];

  const convo = [...messages];
  const toolsUsed = [];
  let reply = "";

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const response = await client.send(
      new ConverseCommand({
        modelId,
        system,
        messages: convo,
        toolConfig: { tools: TOOL_SPECS },
        inferenceConfig: { maxTokens: 1024, temperature: 0 },
      }),
    );

    const message = response?.output?.message;
    if (message) convo.push(message);

    if (response?.stopReason === "tool_use") {
      await handleToolUses({ requested: toolUses(message), messages: convo, toolsUsed });
      continue;
    }

    reply = assistantText(message);
    break;
  }

  // Dedupe the tool names while preserving first-seen order.
  const uniqueTools = [...new Set(toolsUsed)];
  return { reply, toolsUsed: uniqueTools };
}

export const handler = async (event) => {
  const correlationId = event?.requestContext?.requestId
    ?? event?.headers?.["x-correlation-id"]
    ?? null;
  logger.appendKeys({ correlationId, handler: "copilot" });

  try {
    const method = event?.httpMethod || event?.requestContext?.http?.method;
    if (method === "OPTIONS") {
      return jsonResponse(204, {});
    }

    const body = parseBody(event);
    const messages = buildMessages(body);
    const { reply, toolsUsed } = await runCopilot({ messages });
    logger.info("copilot answered", { toolsUsed });
    return jsonResponse(200, { reply, toolsUsed });
  } catch (err) {
    if (err instanceof ApiError) {
      logger.warn("copilot mapped error", {
        statusCode: err.statusCode,
        code: err.code,
        message: err.message,
      });
      return jsonResponse(err.statusCode, { message: err.message, code: err.code });
    }
    logger.error("copilot unhandled error", {
      errorName: err?.name,
      error: err?.message,
      stack: err?.stack,
    });
    return jsonResponse(500, { message: "Internal server error" });
  } finally {
    logger.resetKeys();
  }
};
