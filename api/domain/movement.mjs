import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  TransactWriteCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, ddb } from "../services/ddb.mjs";
import { nowIso } from "../services/time.mjs";
import { publishEvent } from "../services/events.mjs";
import { BadRequestError, NotFoundError } from "../services/errors.mjs";
import { pastureExists } from "./pasture.mjs";

// Move events and the animal->pasture pointer both live under the
// animal's partition:
//   Move event:   pk = ANIMAL#<id>, sk = MOVE#<ts>
//   Pointer item: pk = ANIMAL#<id>, sk = PASTURE
//
// The pointer carries gsi1pk = PASTURE#<toPastureId>, gsi1sk = ANIMAL#<id>
// so "who is in this pasture" is a single GSI1 Query (access pattern #5).
// The movement stream OWNS writing/updating this pointer item.

export function pointerKey(animalId) {
  return { pk: `ANIMAL#${animalId}`, sk: "PASTURE" };
}

export function moveKey(animalId, ts) {
  return { pk: `ANIMAL#${animalId}`, sk: `MOVE#${ts}` };
}

// Reads the animal's current pasture pointer (if any) so a move can record
// where it came from. Returns null when the animal has never been placed.
async function getCurrentPointer(animalId) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: pointerKey(animalId),
  }));
  return result.Item ?? null;
}

// Moves an animal to a target pasture at a timestamp. Writes the MOVE
// history event and upserts the animal's pasture pointer (pointing its
// gsi1pk at the new pasture) in a single TransactWrite, then publishes
// AnimalMoved. Validates the target pasture exists first.
export async function moveAnimal(animalId, fields) {
  const { toPastureId, notes } = fields;
  const ts = fields.ts ?? nowIso();

  if (!(await pastureExists(toPastureId))) {
    throw new NotFoundError("pasture", toPastureId);
  }

  const current = await getCurrentPointer(animalId);
  const fromPastureId = current?.toPastureId ?? null;

  // No-op moves (same pasture) are a client error: there's nothing to
  // record and it likely signals a bug in the caller.
  if (fromPastureId && fromPastureId === toPastureId) {
    throw new BadRequestError(`animal ${animalId} is already in pasture ${toPastureId}`);
  }

  const moveItem = {
    ...moveKey(animalId, ts),
    entity: "Move",
    animalId,
    fromPastureId,
    toPastureId,
    ts,
    notes,
  };

  const pointerItem = {
    ...pointerKey(animalId),
    entity: "AnimalPasture",
    animalId,
    toPastureId,
    ts,
    gsi1pk: `PASTURE#${toPastureId}`,
    gsi1sk: `ANIMAL#${animalId}`,
  };

  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: TABLE_NAME,
          Item: moveItem,
          ConditionExpression: "attribute_not_exists(sk)",
        },
      },
      {
        Put: {
          TableName: TABLE_NAME,
          Item: pointerItem,
        },
      },
    ],
  }));

  await publishEvent("AnimalMoved", {
    animalId,
    fromPastureId,
    toPastureId,
    ts,
  });

  return moveItem;
}

// Lists an animal's move history chronologically via a base-table Query
// (pk = ANIMAL#<id>, begins_with(sk, "MOVE#")). Access pattern #6.
export async function listAnimalMoves(animalId, { limit, exclusiveStartKey } = {}) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
    ExpressionAttributeValues: {
      ":pk": `ANIMAL#${animalId}`,
      ":prefix": "MOVE#",
    },
    Limit: limit,
    ExclusiveStartKey: exclusiveStartKey,
  }));
  return {
    items: result.Items ?? [],
    lastEvaluatedKey: result.LastEvaluatedKey,
  };
}

// Deletes a single move-history event (pk = ANIMAL#<id>, sk = MOVE#<ts>).
// Used for test cleanup; does not touch the pasture pointer.
export async function deleteMove(animalId, ts) {
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: moveKey(animalId, ts),
      ConditionExpression: "attribute_exists(sk)",
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || err?.name === "ConditionalCheckFailedException") {
      throw new NotFoundError("move", `${animalId}/${ts}`);
    }
    throw err;
  }
}
