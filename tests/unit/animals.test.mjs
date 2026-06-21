import { jest } from "@jest/globals";

// Animal + lifecycle unit tests. We mock the shared `ddb` document client and
// the EventBridge `publishEvent` so no AWS call happens; assertions inspect the
// command inputs the domain layer builds (keys, indexes, transactions). The
// route layer is exercised end-to-end through the real Lambda handler.

process.env.TABLE_NAME = "homestead-test";
process.env.EVENT_BUS_NAME = "default";

// A single jest.fn() stands in for ddb.send(); each test queues its responses.
const send = jest.fn();
jest.unstable_mockModule("../../api/services/ddb.mjs", () => ({
  ddb: { send },
  TABLE_NAME: "homestead-test",
}));

// Capture published events without hitting EventBridge.
const publishEvent = jest.fn().mockResolvedValue({});
jest.unstable_mockModule("../../api/services/events.mjs", () => ({
  publishEvent,
}));

const domain = await import("../../api/domain/animal.mjs");
const { handler } = await import("../../api/index.mjs");

const ULID = "01HZY00000000000000000AN01";
const ULID2 = "01HZY00000000000000000DM02";

// Minimal API Gateway V1 proxy event the Powertools Router accepts.
function apiEvent({ httpMethod = "GET", path = "/animals", body = null, query = null }) {
  return {
    httpMethod,
    path,
    resource: path,
    headers: { Host: "example.com", "content-type": "application/json" },
    multiValueHeaders: {},
    requestContext: { domainName: "example.com", requestId: "req-1" },
    isBase64Encoded: false,
    body: body === null ? null : JSON.stringify(body),
    pathParameters: null,
    queryStringParameters: query,
    multiValueQueryStringParameters: null,
    stageVariables: null,
  };
}

// Returns the input of the Nth ddb.send() command (the command object carries
// its constructor input on `.input`).
function commandInput(callIndex = 0) {
  return send.mock.calls[callIndex][0].input;
}

beforeEach(() => {
  send.mockReset();
  publishEvent.mockClear();
});

describe("domain/animal createAnimal", () => {
  test("writes metadata with the documented keys and indexes", async () => {
    send.mockResolvedValueOnce({});
    const animal = await domain.createAnimal({ species: "cattle", status: "active", name: "Bessie" });

    const input = commandInput(0);
    const item = input.TransactItems[0].Put.Item;
    expect(item.pk).toBe(`ANIMAL#${animal.id}`);
    expect(item.sk).toBe("METADATA");
    expect(item.gsi1pk).toBe("SPECIES#cattle");
    expect(item.gsi1sk).toBe(`STATUS#active#${animal.id}`);
    expect(item.gsi2pk).toBe("ANIMAL");
    expect(item.gsi2sk).toBe(`STATUS#active#${item.createdAt}#${animal.id}`);
    expect(item.name).toBe("Bessie");
    // No pasture given -> no pointer write.
    expect(input.TransactItems).toHaveLength(1);
  });

  test("adds a pasture pointer item when a pasture is assigned", async () => {
    send.mockResolvedValueOnce({});
    await domain.createAnimal({ species: "sheep", status: "active", pasture: ULID2 });

    const input = commandInput(0);
    expect(input.TransactItems).toHaveLength(2);
    const pointer = input.TransactItems[1].Put.Item;
    expect(pointer.sk).toBe("PASTURE");
    expect(pointer.gsi1pk).toBe(`PASTURE#${ULID2}`);
    expect(pointer.gsi1sk).toMatch(/^ANIMAL#/);
  });
});

describe("domain/animal getAnimal", () => {
  test("GetItem on METADATA, returns the item", async () => {
    send.mockResolvedValueOnce({ Item: { id: ULID, status: "active" } });
    const animal = await domain.getAnimal(ULID);
    expect(commandInput(0).Key).toEqual({ pk: `ANIMAL#${ULID}`, sk: "METADATA" });
    expect(animal.id).toBe(ULID);
  });

  test("throws NotFoundError when missing", async () => {
    send.mockResolvedValueOnce({});
    await expect(domain.getAnimal(ULID)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("domain/animal listAnimals — one indexed query per filter", () => {
  test("species filter queries GSI1 SPECIES partition", async () => {
    send.mockResolvedValueOnce({ Items: [{ id: ULID }] });
    await domain.listAnimals({ species: "cattle" });
    const input = commandInput(0);
    expect(input.IndexName).toBe("GSI1");
    expect(input.ExpressionAttributeValues[":pk"]).toBe("SPECIES#cattle");
    expect(input.KeyConditionExpression).not.toContain("begins_with");
  });

  test("species + status adds begins_with on gsi1sk", async () => {
    send.mockResolvedValueOnce({ Items: [] });
    await domain.listAnimals({ species: "cattle", status: "active" });
    const input = commandInput(0);
    expect(input.KeyConditionExpression).toContain("begins_with(gsi1sk, :sk)");
    expect(input.ExpressionAttributeValues[":sk"]).toBe("STATUS#active#");
  });

  test("status filter queries GSI2 ANIMAL partition newest-first", async () => {
    send.mockResolvedValueOnce({ Items: [] });
    await domain.listAnimals({ status: "sold" });
    const input = commandInput(0);
    expect(input.IndexName).toBe("GSI2");
    expect(input.ExpressionAttributeValues[":pk"]).toBe("ANIMAL");
    expect(input.ExpressionAttributeValues[":sk"]).toBe("STATUS#sold#");
    expect(input.ScanIndexForward).toBe(false);
  });

  test("no filter lists all via GSI2 with no sort-key condition", async () => {
    send.mockResolvedValueOnce({ Items: [] });
    await domain.listAnimals({});
    const input = commandInput(0);
    expect(input.IndexName).toBe("GSI2");
    expect(input.KeyConditionExpression).toBe("gsi2pk = :pk");
  });

  test("pasture filter queries GSI1 PASTURE partition then hydrates by GetItem", async () => {
    send
      .mockResolvedValueOnce({ Items: [{ id: ULID }] }) // pointer query
      .mockResolvedValueOnce({ Item: { id: ULID, status: "active" } }); // hydration
    const animals = await domain.listAnimals({ pasture: ULID2 });
    const queryInput = commandInput(0);
    expect(queryInput.IndexName).toBe("GSI1");
    expect(queryInput.ExpressionAttributeValues[":pk"]).toBe(`PASTURE#${ULID2}`);
    expect(commandInput(1).Key).toEqual({ pk: `ANIMAL#${ULID}`, sk: "METADATA" });
    expect(animals).toHaveLength(1);
  });
});

describe("domain/animal updateAnimal", () => {
  test("recomputes GSI sort keys on a status change", async () => {
    send
      .mockResolvedValueOnce({ Item: { id: ULID, status: "active", createdAt: "2026-01-01T00:00:00.000Z" } })
      .mockResolvedValueOnce({ Attributes: { id: ULID, status: "sold" } });
    await domain.updateAnimal(ULID, { status: "sold" });
    const update = commandInput(1);
    expect(update.ExpressionAttributeValues[":gsi1sk"]).toBe(`STATUS#sold#${ULID}`);
    expect(update.ExpressionAttributeValues[":gsi2sk"]).toBe(`STATUS#sold#2026-01-01T00:00:00.000Z#${ULID}`);
  });

  test("does not touch GSI keys when status is unchanged", async () => {
    send
      .mockResolvedValueOnce({ Item: { id: ULID, status: "active", createdAt: "2026-01-01T00:00:00.000Z" } })
      .mockResolvedValueOnce({ Attributes: { id: ULID, name: "Daisy" } });
    await domain.updateAnimal(ULID, { name: "Daisy" });
    const update = commandInput(1);
    expect(update.ExpressionAttributeValues[":gsi1sk"]).toBeUndefined();
  });
});

describe("domain/animal deleteAnimal cascade", () => {
  test("queries the partition and deletes every child key", async () => {
    send
      .mockResolvedValueOnce({ Item: { id: ULID } }) // findAnimal
      .mockResolvedValueOnce({
        Items: [
          { pk: `ANIMAL#${ULID}`, sk: "METADATA" },
          { pk: `ANIMAL#${ULID}`, sk: "PASTURE" },
          { pk: `ANIMAL#${ULID}`, sk: "EVENT#2026-01-01T00:00:00.000Z" },
        ],
      })
      .mockResolvedValue({}); // deletes
    await domain.deleteAnimal(ULID);
    // 1 findAnimal + 1 query + 3 deletes
    expect(send).toHaveBeenCalledTimes(5);
    const deleteKeys = send.mock.calls.slice(2).map((c) => c[0].input.Key.sk);
    expect(deleteKeys).toEqual(
      expect.arrayContaining(["METADATA", "PASTURE", "EVENT#2026-01-01T00:00:00.000Z"]),
    );
  });

  test("throws NotFoundError when the animal is gone", async () => {
    send.mockResolvedValueOnce({}); // findAnimal -> no Item
    await expect(domain.deleteAnimal(ULID)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("domain/animal recordBirth", () => {
  test("transacts metadata + BIRTH event and links parents", async () => {
    send.mockResolvedValueOnce({});
    const { animal, event } = await domain.recordBirth({
      animal: { species: "goat", status: "active", dob: "2026-06-01" },
      damId: ULID2,
      sireId: undefined,
    });

    const items = commandInput(0).TransactItems;
    expect(items).toHaveLength(2);
    const meta = items[0].Put.Item;
    const ev = items[1].Put.Item;
    expect(meta.damId).toBe(ULID2);
    expect(ev.type).toBe("BIRTH");
    expect(ev.sk).toBe("EVENT#2026-06-01T00:00:00.000Z");
    expect(ev.gsi1pk).toBe("EVENT#BIRTH#2026-06");
    expect(animal.id).toBe(event.id);
  });
});

describe("domain/animal recordDeath", () => {
  test("transitions active -> deceased and writes a DEATH event", async () => {
    send
      .mockResolvedValueOnce({ Item: { id: ULID, species: "pig", status: "active", createdAt: "2026-01-01T00:00:00.000Z" } })
      .mockResolvedValueOnce({});
    const { animal } = await domain.recordDeath(ULID, { date: "2026-06-20", cause: "illness" });

    expect(animal.status).toBe("deceased");
    const items = commandInput(1).TransactItems;
    expect(items[0].Update.ExpressionAttributeValues[":status"]).toBe("deceased");
    expect(items[0].Update.ConditionExpression).toContain("#status = :active");
    expect(items[1].Put.Item.type).toBe("DEATH");
    expect(items[1].Put.Item.gsi1pk).toBe("EVENT#DEATH#2026-06");
  });

  test("throws ConflictError when the animal is not active", async () => {
    send.mockResolvedValueOnce({ Item: { id: ULID, status: "deceased", createdAt: "2026-01-01T00:00:00.000Z" } });
    await expect(domain.recordDeath(ULID, {})).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("HTTP routes through the Lambda handler", () => {
  test("POST /animals -> 201 with formatted animal", async () => {
    send.mockResolvedValueOnce({});
    const res = await handler(
      apiEvent({ httpMethod: "POST", path: "/animals", body: { species: "cattle", name: "Bessie" } }),
      {},
    );
    expect(res.statusCode).toBe(201);
    const out = JSON.parse(res.body);
    expect(out.species).toBe("cattle");
    expect(out.status).toBe("active");
    expect(out).not.toHaveProperty("pk");
  });

  test("POST /animals with bad body -> 400", async () => {
    const res = await handler(
      apiEvent({ httpMethod: "POST", path: "/animals", body: { name: "no species" } }),
      {},
    );
    expect(res.statusCode).toBe(400);
  });

  test("GET /animals/:id -> 200", async () => {
    send.mockResolvedValueOnce({ Item: { id: ULID, species: "cattle", status: "active", createdAt: "x", updatedAt: "x" } });
    const res = await handler(apiEvent({ httpMethod: "GET", path: `/animals/${ULID}` }), {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).id).toBe(ULID);
  });

  test("GET /animals?species= -> 200 list", async () => {
    send.mockResolvedValueOnce({ Items: [{ id: ULID, species: "cattle", status: "active", createdAt: "x", updatedAt: "x" }] });
    const res = await handler(apiEvent({ httpMethod: "GET", path: "/animals", query: { species: "cattle" } }), {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).animals).toHaveLength(1);
  });

  test("PATCH /animals/:id -> 200", async () => {
    send
      .mockResolvedValueOnce({ Item: { id: ULID, status: "active", createdAt: "2026-01-01T00:00:00.000Z" } })
      .mockResolvedValueOnce({ Attributes: { id: ULID, name: "Daisy", species: "cattle", status: "active", createdAt: "x", updatedAt: "y" } });
    const res = await handler(
      apiEvent({ httpMethod: "PATCH", path: `/animals/${ULID}`, body: { name: "Daisy" } }),
      {},
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).name).toBe("Daisy");
  });

  test("DELETE /animals/:id -> 204", async () => {
    send
      .mockResolvedValueOnce({ Item: { id: ULID } })
      .mockResolvedValueOnce({ Items: [{ pk: `ANIMAL#${ULID}`, sk: "METADATA" }] })
      .mockResolvedValue({});
    const res = await handler(apiEvent({ httpMethod: "DELETE", path: `/animals/${ULID}` }), {});
    expect(res.statusCode).toBe(204);
  });

  test("POST /births -> 201 and publishes AnimalBorn", async () => {
    send.mockResolvedValueOnce({});
    const res = await handler(
      apiEvent({ httpMethod: "POST", path: "/births", body: { species: "goat", dob: "2026-06-01", damId: ULID2 } }),
      {},
    );
    expect(res.statusCode).toBe(201);
    const out = JSON.parse(res.body);
    expect(out.animal.species).toBe("goat");
    expect(out.event.type).toBe("BIRTH");
    expect(publishEvent).toHaveBeenCalledWith("AnimalBorn", expect.objectContaining({ species: "goat" }));
  });

  test("GET /animals/:id/events -> 200", async () => {
    send
      .mockResolvedValueOnce({ Item: { id: ULID, status: "active" } }) // getAnimal
      .mockResolvedValueOnce({ Items: [{ type: "BIRTH", ts: "2026-06-01T00:00:00.000Z" }] });
    const res = await handler(apiEvent({ httpMethod: "GET", path: `/animals/${ULID}/events` }), {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).events[0].type).toBe("BIRTH");
  });

  test("POST /animals/:id/death -> 200 and publishes AnimalDied", async () => {
    send
      .mockResolvedValueOnce({ Item: { id: ULID, species: "pig", status: "active", createdAt: "2026-01-01T00:00:00.000Z" } })
      .mockResolvedValueOnce({});
    const res = await handler(
      apiEvent({ httpMethod: "POST", path: `/animals/${ULID}/death`, body: { date: "2026-06-20", cause: "illness" } }),
      {},
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).animal.status).toBe("deceased");
    expect(publishEvent).toHaveBeenCalledWith("AnimalDied", expect.objectContaining({ id: ULID }));
  });

  test("POST /animals/:id/death on a non-active animal -> 409", async () => {
    send.mockResolvedValueOnce({ Item: { id: ULID, status: "sold", createdAt: "2026-01-01T00:00:00.000Z" } });
    const res = await handler(
      apiEvent({ httpMethod: "POST", path: `/animals/${ULID}/death`, body: {} }),
      {},
    );
    expect(res.statusCode).toBe(409);
    expect(publishEvent).not.toHaveBeenCalled();
  });
});
