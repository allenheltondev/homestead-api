import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, ddb } from "../services/ddb.mjs";
import { newId } from "../services/id.mjs";
import { nowIso } from "../services/time.mjs";
import { ConflictError, NotFoundError } from "../services/errors.mjs";

// Pasture records live at:
//   pk = PASTURE#<id>, sk = METADATA
//
// They also carry gsi1pk = "PASTURE" with gsi1sk = <name> so the
// "list all pastures, alphabetical" view is a single Query on GSI1
// (data model access pattern #10). No Scans.

const PASTURE_PARTITION = "PASTURE";

export function pastureKey(id) {
  return { pk: `PASTURE#${id}`, sk: "METADATA" };
}

export async function createPasture(fields) {
  const id = newId();
  const now = nowIso();
  const item = {
    ...pastureKey(id),
    entity: "Pasture",
    id,
    ...fields,
    gsi1pk: PASTURE_PARTITION,
    gsi1sk: fields.name,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: "attribute_not_exists(pk)",
  }));

  return item;
}

export async function getPasture(id) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: pastureKey(id),
  }));
  if (!result.Item) {
    throw new NotFoundError("pasture", id);
  }
  return result.Item;
}

// Existence check that does not throw — used before writing a move so we
// can raise the right error from the movement domain.
export async function pastureExists(id) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: pastureKey(id),
    ProjectionExpression: "pk",
  }));
  return Boolean(result.Item);
}

// Lists all pastures alphabetically by name via GSI1 (gsi1pk = PASTURE).
export async function listPastures({ limit, exclusiveStartKey } = {}) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": PASTURE_PARTITION },
    ScanIndexForward: true, // alphabetical by name
    Limit: limit,
    ExclusiveStartKey: exclusiveStartKey,
  }));

  return {
    items: result.Items ?? [],
    lastEvaluatedKey: result.LastEvaluatedKey,
  };
}

// Lists the animals currently in a pasture by Querying GSI1 on the
// pasture-membership partition (gsi1pk = PASTURE#<id>), reading the
// animal->pasture pointer items written by the movement domain.
export async function listPastureAnimals(id) {
  // Confirm the pasture exists first so "no such pasture" isn't conflated
  // with "empty pasture".
  await getPasture(id);

  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
    ExpressionAttributeValues: {
      ":pk": `PASTURE#${id}`,
      ":prefix": "ANIMAL#",
    },
  }));
  return result.Items ?? [];
}

export async function deletePasture(id) {
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: pastureKey(id),
      ConditionExpression: "attribute_exists(pk)",
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || err?.name === "ConditionalCheckFailedException") {
      throw new NotFoundError("pasture", id);
    }
    throw err;
  }
}

// Re-exported so route code can map a duplicate-create conflict without
// importing the SDK error directly.
export function isConditionalCheckFailed(err) {
  return err instanceof ConditionalCheckFailedException || err?.name === "ConditionalCheckFailedException";
}

export { ConflictError };
