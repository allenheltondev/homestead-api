import { jest } from "@jest/globals";

process.env.TABLE_NAME = "homestead-test";
process.env.BEDROCK_MODEL_ID = "us.amazon.nova-pro-v1:0";

// Mock the Bedrock Converse client so the tool-use loop runs without AWS.
const bedrockSend = jest.fn();
const ConverseCommand = jest.fn((input) => ({ input }));
jest.unstable_mockModule("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn(() => ({ send: bedrockSend })),
  ConverseCommand,
}));

// Mock the tool registry so the loop's tool execution is isolated from DDB.
const herdHandler = jest.fn();
jest.unstable_mockModule("../../api/copilot/tools.mjs", () => ({
  TOOL_SPECS: [
    {
      toolSpec: {
        name: "get_herd_summary",
        description: "herd",
        inputSchema: { json: { type: "object", properties: {}, required: [] } },
      },
    },
  ],
  REGISTRY: { get_herd_summary: herdHandler },
}));

const { handler, runCopilot, buildMessages } = await import("../../api/copilot.mjs");

beforeEach(() => {
  bedrockSend.mockReset();
  ConverseCommand.mockClear();
  herdHandler.mockReset();
});

function proxyEvent(body) {
  return {
    httpMethod: "POST",
    requestContext: { requestId: "req-1", http: { method: "POST" } },
    headers: {},
    body: JSON.stringify(body),
  };
}

describe("buildMessages", () => {
  test("maps valid messages to Converse content blocks", () => {
    const out = buildMessages({ messages: [{ role: "user", content: "hi" }] });
    expect(out).toEqual([{ role: "user", content: [{ text: "hi" }] }]);
  });

  test("rejects a missing messages array", () => {
    expect(() => buildMessages({})).toThrow(/non-empty array/);
  });

  test("rejects a bad role", () => {
    expect(() => buildMessages({ messages: [{ role: "system", content: "x" }] }))
      .toThrow(/role/);
  });

  test("rejects empty content", () => {
    expect(() => buildMessages({ messages: [{ role: "user", content: "  " }] }))
      .toThrow(/content/);
  });
});

describe("runCopilot tool-use loop", () => {
  test("executes a requested tool then returns the end_turn reply", async () => {
    herdHandler.mockResolvedValue({ total: 7 });

    // First response: model asks for the herd tool. Second: final text.
    bedrockSend
      .mockResolvedValueOnce({
        stopReason: "tool_use",
        output: {
          message: {
            role: "assistant",
            content: [
              { toolUse: { toolUseId: "tu-1", name: "get_herd_summary", input: {} } },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        stopReason: "end_turn",
        output: {
          message: { role: "assistant", content: [{ text: "You have 7 animals." }] },
        },
      });

    const { reply, toolsUsed } = await runCopilot({
      messages: [{ role: "user", content: [{ text: "how many animals?" }] }],
    });

    expect(herdHandler).toHaveBeenCalledTimes(1);
    expect(reply).toBe("You have 7 animals.");
    expect(toolsUsed).toEqual(["get_herd_summary"]);
    expect(bedrockSend).toHaveBeenCalledTimes(2);

    // The second Converse call must include the toolResult turn.
    const secondCall = ConverseCommand.mock.calls[1][0];
    const toolResultTurn = secondCall.messages.find(
      (m) => m.content?.[0]?.toolResult,
    );
    expect(toolResultTurn.content[0].toolResult.toolUseId).toBe("tu-1");
    expect(toolResultTurn.content[0].toolResult.content[0].json).toEqual({ total: 7 });
  });

  test("returns reply directly when the model ends without tools", async () => {
    bedrockSend.mockResolvedValueOnce({
      stopReason: "end_turn",
      output: { message: { role: "assistant", content: [{ text: "I can only help with the farm." }] } },
    });
    const { reply, toolsUsed } = await runCopilot({
      messages: [{ role: "user", content: [{ text: "what's the weather in paris?" }] }],
    });
    expect(reply).toBe("I can only help with the farm.");
    expect(toolsUsed).toEqual([]);
    expect(herdHandler).not.toHaveBeenCalled();
  });

  test("surfaces a tool error as an error toolResult and keeps going", async () => {
    herdHandler.mockRejectedValue(new Error("boom"));
    bedrockSend
      .mockResolvedValueOnce({
        stopReason: "tool_use",
        output: {
          message: {
            role: "assistant",
            content: [{ toolUse: { toolUseId: "tu-9", name: "get_herd_summary", input: {} } }],
          },
        },
      })
      .mockResolvedValueOnce({
        stopReason: "end_turn",
        output: { message: { role: "assistant", content: [{ text: "Sorry, no data." }] } },
      });

    const { reply, toolsUsed } = await runCopilot({
      messages: [{ role: "user", content: [{ text: "herd?" }] }],
    });
    expect(reply).toBe("Sorry, no data.");
    expect(toolsUsed).toEqual(["get_herd_summary"]);
    // The second Converse call carries the appended error toolResult turn.
    const secondCall = ConverseCommand.mock.calls[1][0];
    const toolResultTurn = secondCall.messages.find(
      (m) => m.content?.[0]?.toolResult,
    );
    expect(toolResultTurn.content[0].toolResult.status).toBe("error");
  });
});

describe("handler", () => {
  test("returns 200 with reply + toolsUsed for a valid request", async () => {
    bedrockSend.mockResolvedValueOnce({
      stopReason: "end_turn",
      output: { message: { role: "assistant", content: [{ text: "All good." }] } },
    });
    const res = await handler(proxyEvent({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.reply).toBe("All good.");
    expect(body.toolsUsed).toEqual([]);
    expect(res.headers["content-type"]).toBe("application/json");
  });

  test("returns 400 on a malformed body shape", async () => {
    const res = await handler(proxyEvent({ messages: [] }));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("BadRequest");
  });

  test("returns 500 when the Bedrock client throws", async () => {
    bedrockSend.mockRejectedValue(new Error("bedrock down"));
    const res = await handler(proxyEvent({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.statusCode).toBe(500);
  });
});
