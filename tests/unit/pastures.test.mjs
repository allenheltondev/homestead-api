import { jest } from "@jest/globals";

// Mock the shared DynamoDB document client so no AWS call happens. The
// pasture domain dispatches Get/Put/Query/Delete commands through ddb.send;
// each test stubs send's resolved value and asserts the command input.
const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));

const { handler } = await import("../../api/index.mjs");

// API Gateway proxy (V1) event matching the Powertools Router detector.
function apiEvent({ httpMethod = "GET", path = "/pastures", body = null, queryStringParameters = null } = {}) {
  return {
    httpMethod,
    path,
    resource: path,
    headers: { Host: "example.com" },
    multiValueHeaders: {},
    requestContext: { domainName: "example.com", requestId: "req-1" },
    isBase64Encoded: false,
    body: body === null ? null : JSON.stringify(body),
    pathParameters: null,
    queryStringParameters,
    multiValueQueryStringParameters: null,
    stageVariables: null,
  };
}

beforeEach(() => {
  send.mockReset();
});

describe("POST /pastures", () => {
  test("creates a pasture and returns 201 with the formatted item", async () => {
    send.mockResolvedValueOnce({}); // PutCommand

    const result = await handler(
      apiEvent({ httpMethod: "POST", path: "/pastures", body: { name: "North Field", acreage: 12.5, notes: "shade" } }),
      {},
    );

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body).toMatchObject({ name: "North Field", acreage: 12.5, notes: "shade" });
    expect(typeof body.id).toBe("string");

    const putInput = send.mock.calls[0][0].input;
    expect(putInput.Item.pk).toBe(`PASTURE#${body.id}`);
    expect(putInput.Item.sk).toBe("METADATA");
    expect(putInput.Item.gsi1pk).toBe("PASTURE");
    expect(putInput.Item.gsi1sk).toBe("North Field");
    expect(putInput.ConditionExpression).toContain("attribute_not_exists");
  });

  test("rejects a missing name with 400", async () => {
    const result = await handler(
      apiEvent({ httpMethod: "POST", path: "/pastures", body: { acreage: 5 } }),
      {},
    );
    expect(result.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("GET /pastures", () => {
  test("lists pastures via GSI1 PASTURE partition", async () => {
    send.mockResolvedValueOnce({
      Items: [
        { id: "p1", name: "Alpha", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "p2", name: "Beta", createdAt: "2026-01-02T00:00:00.000Z" },
      ],
    });

    const result = await handler(apiEvent({ path: "/pastures" }), {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.pastures).toHaveLength(2);
    expect(body.pastures[0]).toMatchObject({ id: "p1", name: "Alpha" });

    const queryInput = send.mock.calls[0][0].input;
    expect(queryInput.IndexName).toBe("GSI1");
    expect(queryInput.ExpressionAttributeValues[":pk"]).toBe("PASTURE");
  });
});

describe("GET /pastures/{id}", () => {
  test("returns 200 with the pasture", async () => {
    send.mockResolvedValueOnce({ Item: { id: "p1", name: "Alpha", acreage: 3 } });

    const result = await handler(apiEvent({ path: "/pastures/p1" }), {});

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ id: "p1", name: "Alpha" });

    const getInput = send.mock.calls[0][0].input;
    expect(getInput.Key).toEqual({ pk: "PASTURE#p1", sk: "METADATA" });
  });

  test("returns 404 when the pasture is missing", async () => {
    send.mockResolvedValueOnce({}); // no Item

    const result = await handler(apiEvent({ path: "/pastures/nope" }), {});
    expect(result.statusCode).toBe(404);
  });
});

describe("GET /pastures/{id}/animals", () => {
  test("returns occupancy via GSI1 PASTURE#<id> query", async () => {
    send
      .mockResolvedValueOnce({ Item: { id: "p1", name: "Alpha" } }) // existence Get
      .mockResolvedValueOnce({
        Items: [
          { animalId: "a1", toPastureId: "p1", ts: "2026-01-01T00:00:00.000Z" },
          { animalId: "a2", toPastureId: "p1", ts: "2026-01-02T00:00:00.000Z" },
        ],
      });

    const result = await handler(apiEvent({ path: "/pastures/p1/animals" }), {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.pastureId).toBe("p1");
    expect(body.animals).toHaveLength(2);
    expect(body.animals[0]).toMatchObject({ animalId: "a1", pastureId: "p1" });

    const queryInput = send.mock.calls[1][0].input;
    expect(queryInput.IndexName).toBe("GSI1");
    expect(queryInput.ExpressionAttributeValues[":pk"]).toBe("PASTURE#p1");
    expect(queryInput.ExpressionAttributeValues[":prefix"]).toBe("ANIMAL#");
  });

  test("returns 404 when the pasture does not exist", async () => {
    send.mockResolvedValueOnce({}); // existence Get returns nothing

    const result = await handler(apiEvent({ path: "/pastures/nope/animals" }), {});
    expect(result.statusCode).toBe(404);
  });
});

describe("DELETE /pastures/{id}", () => {
  test("deletes and returns 204", async () => {
    send.mockResolvedValueOnce({});

    const result = await handler(apiEvent({ httpMethod: "DELETE", path: "/pastures/p1" }), {});

    expect(result.statusCode).toBe(204);
    const deleteInput = send.mock.calls[0][0].input;
    expect(deleteInput.Key).toEqual({ pk: "PASTURE#p1", sk: "METADATA" });
    expect(deleteInput.ConditionExpression).toContain("attribute_exists");
  });

  test("returns 404 when deleting a missing pasture", async () => {
    const err = new Error("conditional check failed");
    err.name = "ConditionalCheckFailedException";
    send.mockRejectedValueOnce(err);

    const result = await handler(apiEvent({ httpMethod: "DELETE", path: "/pastures/nope" }), {});
    expect(result.statusCode).toBe(404);
  });
});
