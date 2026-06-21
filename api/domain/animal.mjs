import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../services/ddb.mjs";
import { ConflictError, NotFoundError } from "../services/errors.mjs";
import { newId } from "../services/id.mjs";
import { nowIso, yyyymm } from "../services/time.mjs";

// Single-table data access for animals + their lifecycle events and pasture
// pointer. Key schema (see docs/DATA_MODEL.md):
//
//   Animal metadata  pk=ANIMAL#<id>      sk=METADATA
//                    gsi1pk=SPECIES#<species>  gsi1sk=STATUS#<status>#<id>
//                    gsi2pk=ANIMAL             gsi2sk=STATUS#<status>#<createdAt>#<id>
//   Pasture pointer  pk=ANIMAL#<id>      sk=PASTURE
//                    gsi1pk=PASTURE#<pastureId> gsi1sk=ANIMAL#<id>
//   Lifecycle event  pk=ANIMAL#<id>      sk=EVENT#<ts>
//                    gsi1pk=EVENT#<TYPE>#<yyyy-mm> gsi1sk=<ts>
//
// Every read here is a GetItem or a Query on the base table / GSI1 / GSI2 —
// there are NO Scans.

const ANIMAL_PARTITION = "ANIMAL";

function metadataKey(id) {
  return { pk: `ANIMAL#${id}`, sk: "METADATA" };
}

function pastureKey(id) {
  return { pk: `ANIMAL#${id}`, sk: "PASTURE" };
}

// Builds the metadata item from already-validated fields. Shared by
// createAnimal and recordBirth so the indexed-key shape stays identical.
function buildMetadataItem({ id, createdAt, updatedAt, fields }) {
  const { species, status } = fields;
  return {
    ...metadataKey(id),
    entity: "Animal",
    id,
    species,
    breed: fields.breed,
    name: fields.name,
    tag: fields.tag,
    sex: fields.sex,
    dob: fields.dob,
    status,
    pasture: fields.pasture,
    damId: fields.damId,
    sireId: fields.sireId,
    gsi1pk: `SPECIES#${species}`,
    gsi1sk: `STATUS#${status}#${id}`,
    gsi2pk: ANIMAL_PARTITION,
    gsi2sk: `STATUS#${status}#${createdAt}#${id}`,
    createdAt,
    updatedAt,
  };
}

function buildPasturePointer(id, pastureId) {
  return {
    ...pastureKey(id),
    entity: "AnimalPasture",
    id,
    pastureId,
    gsi1pk: `PASTURE#${pastureId}`,
    gsi1sk: `ANIMAL#${id}`,
  };
}

function buildEventItem({ id, type, ts, detail }) {
  return {
    pk: `ANIMAL#${id}`,
    sk: `EVENT#${ts}`,
    entity: "AnimalEvent",
    id,
    type,
    ts,
    ...detail,
    gsi1pk: `EVENT#${type}#${yyyymm(ts)}`,
    gsi1sk: ts,
  };
}

export async function createAnimal(fields) {
  const id = newId();
  const now = nowIso();
  const metadata = buildMetadataItem({ id, createdAt: now, updatedAt: now, fields });

  const transactItems = [{
    Put: {
      TableName: TABLE_NAME,
      Item: metadata,
      ConditionExpression: "attribute_not_exists(pk)",
    },
  }];

  if (fields.pasture) {
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: buildPasturePointer(id, fields.pasture),
        ConditionExpression: "attribute_not_exists(pk) OR attribute_not_exists(sk)",
      },
    });
  }

  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
  return metadata;
}

export async function getAnimal(id) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: metadataKey(id),
  }));
  if (!result.Item) {
    throw new NotFoundError("animal", id);
  }
  return result.Item;
}

// Same lookup without the throw — used by callers that want to branch on
// existence (e.g. delete short-circuit) or assert a precondition themselves.
export async function findAnimal(id) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: metadataKey(id),
  }));
  return result.Item ?? null;
}

// GET /animals dispatch. Each filter maps to exactly one indexed Query — never
// a Scan:
//   species (+ optional status)  -> GSI1 SPECIES#<species>, begins_with status
//   pasture                       -> GSI1 PASTURE#<pastureId>
//   status / list-all             -> GSI2 ANIMAL, begins_with STATUS#<status>#
export async function listAnimals({ species, status, pasture } = {}) {
  if (pasture) {
    return queryPasture(pasture);
  }
  if (species) {
    return querySpecies(species, status);
  }
  return queryByStatus(status);
}

async function querySpecies(species, status) {
  const values = { ":pk": `SPECIES#${species}` };
  let keyCondition = "gsi1pk = :pk";
  if (status) {
    keyCondition += " AND begins_with(gsi1sk, :sk)";
    values[":sk"] = `STATUS#${status}#`;
  }
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: values,
  }));
  return result.Items ?? [];
}

async function queryByStatus(status) {
  const values = { ":pk": ANIMAL_PARTITION };
  let keyCondition = "gsi2pk = :pk";
  if (status) {
    keyCondition += " AND begins_with(gsi2sk, :sk)";
    values[":sk"] = `STATUS#${status}#`;
  }
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI2",
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: values,
    ScanIndexForward: false, // newest first
  }));
  return result.Items ?? [];
}

// Pasture pointers carry only ids; hydrate to full metadata with batched
// GetItems so the caller gets the same shape as the other list paths. The
// pointer Query is GSI1, the hydration is GetItem — no Scans.
async function queryPasture(pastureId) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :sk)",
    ExpressionAttributeValues: {
      ":pk": `PASTURE#${pastureId}`,
      ":sk": "ANIMAL#",
    },
  }));
  const pointers = result.Items ?? [];
  const animals = await Promise.all(pointers.map((p) => findAnimal(p.id)));
  return animals.filter(Boolean);
}

// PATCH /animals/{id}. Rebuilds the GSI keys when status changes so the
// species/status and list-by-status indexes stay consistent.
export async function updateAnimal(id, fields) {
  const existing = await getAnimal(id);
  const now = nowIso();

  const setClauses = ["#updatedAt = :updatedAt"];
  const names = { "#updatedAt": "updatedAt" };
  const values = { ":updatedAt": now };

  for (const [key, value] of Object.entries(fields)) {
    names[`#${key}`] = key;
    values[`:${key}`] = value;
    setClauses.push(`#${key} = :${key}`);
  }

  // Status is part of both GSIs' sort keys — recompute them on a status change.
  if (fields.status && fields.status !== existing.status) {
    names["#gsi1sk"] = "gsi1sk";
    names["#gsi2sk"] = "gsi2sk";
    values[":gsi1sk"] = `STATUS#${fields.status}#${id}`;
    values[":gsi2sk"] = `STATUS#${fields.status}#${existing.createdAt}#${id}`;
    setClauses.push("#gsi1sk = :gsi1sk", "#gsi2sk = :gsi2sk");
  }

  const result = await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: metadataKey(id),
    UpdateExpression: `SET ${setClauses.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ConditionExpression: "attribute_exists(pk)",
    ReturnValues: "ALL_NEW",
  }));
  return result.Attributes;
}

// DELETE /animals/{id} — cascade. Removes the metadata item, the pasture
// pointer (if any), and every EVENT#/MOVE# child under the animal's partition.
// Reads are a single base-table Query (pattern 2); writes are batched deletes.
export async function deleteAnimal(id) {
  const existing = await findAnimal(id);
  if (!existing) {
    throw new NotFoundError("animal", id);
  }

  // One Query over the animal's partition returns metadata + pointer + all
  // event/move children. No Scan, no per-child read.
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "pk = :pk",
    ExpressionAttributeValues: { ":pk": `ANIMAL#${id}` },
    ProjectionExpression: "pk, sk",
  }));

  const keys = (result.Items ?? []).map((it) => ({ pk: it.pk, sk: it.sk }));
  await batchDelete(keys);
}

// DynamoDB caps BatchWriteItem at 25 requests; chunk accordingly.
async function batchDelete(keys) {
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);
    await Promise.all(chunk.map((Key) => ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key,
    }))));
  }
}

// POST /births — single transaction writes the animal metadata + BIRTH event
// (+ pasture pointer when assigned). Parentage links ride on the metadata item.
export async function recordBirth({ animal, damId, sireId }) {
  const id = newId();
  const now = nowIso();
  const fields = { ...animal, damId, sireId };
  const metadata = buildMetadataItem({ id, createdAt: now, updatedAt: now, fields });

  const ts = animal.dob ? `${animal.dob}T00:00:00.000Z` : now;
  const event = buildEventItem({
    id,
    type: "BIRTH",
    ts,
    detail: { dob: animal.dob, damId, sireId },
  });

  const transactItems = [
    {
      Put: {
        TableName: TABLE_NAME,
        Item: metadata,
        ConditionExpression: "attribute_not_exists(pk)",
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: event,
        ConditionExpression: "attribute_not_exists(sk)",
      },
    },
  ];

  if (animal.pasture) {
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: buildPasturePointer(id, animal.pasture),
      },
    });
  }

  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
  return { animal: metadata, event };
}

// GET /animals/{id}/events — chronological lifecycle history (pattern 7).
export async function listAnimalEvents(id) {
  await getAnimal(id); // 404 if the animal doesn't exist
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
    ExpressionAttributeValues: {
      ":pk": `ANIMAL#${id}`,
      ":sk": "EVENT#",
    },
  }));
  return result.Items ?? [];
}

// POST /animals/{id}/death — flips status active -> deceased and writes a DEATH
// event in one transaction. A death on a non-active animal is a conflict.
export async function recordDeath(id, { date, cause }) {
  return recordTerminalEvent(id, {
    type: "DEATH",
    status: "deceased",
    date,
    detail: { cause },
  });
}

// POST /animals/{id}/sale — flips status active -> sold and writes a SALE event.
export async function recordSale(id, { date, buyer, price }) {
  return recordTerminalEvent(id, {
    type: "SALE",
    status: "sold",
    date,
    detail: { buyer, price },
  });
}

// Shared "terminal transition" — DEATH and SALE both move an active animal to a
// final status and append a typed lifecycle event atomically. Only an active
// animal can transition; anything else is a ConflictError.
async function recordTerminalEvent(id, { type, status, date, detail }) {
  const existing = await getAnimal(id);
  if (existing.status !== "active") {
    throw new ConflictError(
      `animal ${id} is ${existing.status}; only an active animal can be marked ${status}`,
    );
  }

  const now = nowIso();
  const ts = date ? `${date}T00:00:00.000Z` : now;
  const event = buildEventItem({ id, type, ts, detail: { date, ...detail } });

  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: TABLE_NAME,
          Key: metadataKey(id),
          UpdateExpression:
            "SET #status = :status, #updatedAt = :now, #gsi1sk = :gsi1sk, #gsi2sk = :gsi2sk",
          ExpressionAttributeNames: {
            "#status": "status",
            "#updatedAt": "updatedAt",
            "#gsi1sk": "gsi1sk",
            "#gsi2sk": "gsi2sk",
          },
          ExpressionAttributeValues: {
            ":status": status,
            ":now": now,
            ":gsi1sk": `STATUS#${status}#${id}`,
            ":gsi2sk": `STATUS#${status}#${existing.createdAt}#${id}`,
            // Guard against a concurrent transition flipping status first.
            ":active": "active",
          },
          ConditionExpression: "attribute_exists(pk) AND #status = :active",
        },
      },
      {
        Put: {
          TableName: TABLE_NAME,
          Item: event,
          ConditionExpression: "attribute_not_exists(sk)",
        },
      },
    ],
  }));

  return { animal: { ...existing, status, updatedAt: now }, event };
}
