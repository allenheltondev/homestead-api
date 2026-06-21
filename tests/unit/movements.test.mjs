import { jest } from "@jest/globals";

// Mock the shared DynamoDB client and the EventBridge publisher so no AWS
// call happens. The movement domain validates the target pasture (Get),
// reads the current pointer (Get), then runs a TransactWrite and publishes
// AnimalMoved.
const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));

const publishEvent = jest.fn();
jest.unstable_mockModule("../../api/services/events.mjs", () => ({
  publishEvent,
}));

const { handler } = await import("../../api/index.mjs");

function apiEvent({ httpMethod = "GET", path, body = null, queryStringParameters = null } = {}) {
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
  publishEvent.mockReset();
  publishEvent.mockResolvedValue({});
});

describe("POST /animals/{id}/moves", () => {
  test("writes a transaction (move + pointer), publishes AnimalMoved, returns 201", async () => {
    send
      .mockResolvedValueOnce({ Item: { pk: "PASTURE#p2" } }) // target pasture exists
      .mockResolvedValueOnce({ Item: { toPastureId: "p1" } }) // current pointer
      .mockResolvedValueOnce({}); // TransactWrite

    const result = await handler(
      apiEvent({
        httpMethod: "POST",
        path: "/animals/a1/moves",
        body: { toPastureId: "p2", ts: "2026-06-01T12:00:00.000Z", notes: "rotation" },
      }),
      {},
    );

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body).toMatchObject({
      animalId: "a1",
      fromPastureId: "p1",
      toPastureId: "p2",
      ts: "2026-06-01T12:00:00.000Z",
      notes: "rotation",
    });

    // TransactWrite is the third ddb.send call.
    const txInput = send.mock.calls[2][0].input;
    expect(txInput.TransactItems).toHaveLength(2);

    const moveItem = txInput.TransactItems[0].Put.Item;
    expect(moveItem.pk).toBe("ANIMAL#a1");
    expect(moveItem.sk).toBe("MOVE#2026-06-01T12:00:00.000Z");
    expect(moveItem.fromPastureId).toBe("p1");
    expect(moveItem.toPastureId).toBe("p2");

    const pointerItem = txInput.TransactItems[1].Put.Item;
    expect(pointerItem.pk).toBe("ANIMAL#a1");
    expect(pointerItem.sk).toBe("PASTURE");
    expect(pointerItem.gsi1pk).toBe("PASTURE#p2");
    expect(pointerItem.gsi1sk).toBe("ANIMAL#a1");

    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent.mock.calls[0][0]).toBe("AnimalMoved");
    expect(publishEvent.mock.calls[0][1]).toMatchObject({
      animalId: "a1",
      fromPastureId: "p1",
      toPastureId: "p2",
    });
  });

  test("handles a first move (no existing pointer) with fromPastureId null", async () => {
    send
      .mockResolvedValueOnce({ Item: { pk: "PASTURE#p1" } }) // target exists
      .mockResolvedValueOnce({}) // no current pointer
      .mockResolvedValueOnce({}); // TransactWrite

    const result = await handler(
      apiEvent({ httpMethod: "POST", path: "/animals/a1/moves", body: { toPastureId: "p1" } }),
      {},
    );

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body).fromPastureId).toBeNull();
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });

  test("returns 404 when the target pasture does not exist (no transaction, no event)", async () => {
    send.mockResolvedValueOnce({}); // target pasture Get returns nothing

    const result = await handler(
      apiEvent({ httpMethod: "POST", path: "/animals/a1/moves", body: { toPastureId: "ghost" } }),
      {},
    );

    expect(result.statusCode).toBe(404);
    // Only the existence Get ran; no transaction, no publish.
    expect(send).toHaveBeenCalledTimes(1);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  test("rejects a missing toPastureId with 400", async () => {
    const result = await handler(
      apiEvent({ httpMethod: "POST", path: "/animals/a1/moves", body: { notes: "x" } }),
      {},
    );
    expect(result.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  test("rejects a move to the same pasture with 400", async () => {
    send
      .mockResolvedValueOnce({ Item: { pk: "PASTURE#p1" } }) // target exists
      .mockResolvedValueOnce({ Item: { toPastureId: "p1" } }); // already in p1

    const result = await handler(
      apiEvent({ httpMethod: "POST", path: "/animals/a1/moves", body: { toPastureId: "p1" } }),
      {},
    );

    expect(result.statusCode).toBe(400);
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

describe("GET /animals/{id}/moves", () => {
  test("lists move history via base-table Query begins_with(sk, MOVE#)", async () => {
    send.mockResolvedValueOnce({
      Items: [
        { animalId: "a1", toPastureId: "p1", fromPastureId: null, ts: "2026-01-01T00:00:00.000Z" },
        { animalId: "a1", toPastureId: "p2", fromPastureId: "p1", ts: "2026-02-01T00:00:00.000Z" },
      ],
    });

    const result = await handler(apiEvent({ path: "/animals/a1/moves" }), {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.animalId).toBe("a1");
    expect(body.moves).toHaveLength(2);

    const queryInput = send.mock.calls[0][0].input;
    expect(queryInput.ExpressionAttributeValues[":pk"]).toBe("ANIMAL#a1");
    expect(queryInput.ExpressionAttributeValues[":prefix"]).toBe("MOVE#");
    expect(queryInput.IndexName).toBeUndefined(); // base table, not a GSI
  });
});

describe("DELETE /animals/{id}/moves/{ts}", () => {
  test("deletes a move event and returns 204", async () => {
    send.mockResolvedValueOnce({});

    const result = await handler(
      apiEvent({ httpMethod: "DELETE", path: "/animals/a1/moves/2026-06-01T12:00:00.000Z" }),
      {},
    );

    expect(result.statusCode).toBe(204);
    const deleteInput = send.mock.calls[0][0].input;
    expect(deleteInput.Key).toEqual({ pk: "ANIMAL#a1", sk: "MOVE#2026-06-01T12:00:00.000Z" });
  });
});
