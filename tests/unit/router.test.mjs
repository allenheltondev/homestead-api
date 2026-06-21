import { handler } from "../../api/index.mjs";

// A complete API Gateway proxy (V1) event, matching the shape the
// Powertools Router's event detector requires.
function apiGatewayEvent({ httpMethod = "GET", path = "/health" } = {}) {
  return {
    httpMethod,
    path,
    resource: path,
    headers: { Host: "example.com" },
    multiValueHeaders: {},
    requestContext: { domainName: "example.com", requestId: "req-1" },
    isBase64Encoded: false,
    body: null,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
  };
}

describe("router (api/index.mjs handler)", () => {
  test("GET /health returns 200 { status: 'ok' }", async () => {
    const result = await handler(apiGatewayEvent(), {});
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ status: "ok" });
  });

  test("CORS preflight (OPTIONS) short-circuits to 204", async () => {
    const result = await handler(apiGatewayEvent({ httpMethod: "OPTIONS" }), {});
    expect(result.statusCode).toBe(204);
  });

  test("an unregistered route returns 404", async () => {
    const result = await handler(apiGatewayEvent({ path: "/nope" }), {});
    expect(result.statusCode).toBe(404);
  });
});
