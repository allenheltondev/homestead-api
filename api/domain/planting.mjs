import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, ddb } from "../services/ddb.mjs";
import { newId } from "../services/id.mjs";
import { nowIso } from "../services/time.mjs";
import { NotFoundError } from "../services/errors.mjs";

// Planting records live at:
//   pk = PLANTING#<id>, sk = METADATA
//
// They also carry gsi1pk = "PLANTING" with gsi1sk = <plantedAt>#<id> so the
// "list all plantings, newest/oldest first" view is a single Query on GSI1 (a
// collection-partition GSI). Status is stored as a plain attribute (filtered
// in code) so a status change never has to rewrite the index key. No Scans.

const PLANTING_PARTITION = "PLANTING";

export const PLANTING_STATUSES = new Set([
  "planned",
  "growing",
  "harvested",
  "failed",
]);

export function plantingKey(id) {
  return { pk: `PLANTING#${id}`, sk: "METADATA" };
}

export async function createPlanting(fields) {
  const id = newId();
  const now = nowIso();
  const item = {
    ...plantingKey(id),
    entity: "Planting",
    id,
    bedId: fields.bedId,
    cropName: fields.cropName,
    variety: fields.variety,
    plantedAt: fields.plantedAt,
    expectedHarvestAt: fields.expectedHarvestAt,
    status: fields.status,
    gsi1pk: PLANTING_PARTITION,
    gsi1sk: `${fields.plantedAt}#${id}`,
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

export async function getPlanting(id) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: plantingKey(id),
  }));
  if (!result.Item) {
    throw new NotFoundError("planting", id);
  }
  return result.Item;
}

// Lists plantings via GSI1 (gsi1pk = PLANTING), ordered by plantedAt. An
// optional status filter is applied in code so the index key never has to be
// rewritten on a status change. No Scan.
export async function listPlantings({ status } = {}) {
  const items = [];
  let exclusiveStartKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "gsi1pk = :pk",
      ExpressionAttributeValues: { ":pk": PLANTING_PARTITION },
      ScanIndexForward: false, // newest plantedAt first
      ExclusiveStartKey: exclusiveStartKey,
    }));
    for (const item of result.Items ?? []) items.push(item);
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  if (status !== undefined) {
    return items.filter((p) => p.status === status);
  }
  return items;
}

// PATCH /plantings/{id}. Rebuilds gsi1sk when plantedAt changes so the listing
// order stays consistent. Only the supplied fields are written.
export async function updatePlanting(id, fields) {
  const existing = await getPlanting(id);
  const now = nowIso();

  const setClauses = ["#updatedAt = :updatedAt"];
  const names = { "#updatedAt": "updatedAt" };
  const values = { ":updatedAt": now };

  for (const [key, value] of Object.entries(fields)) {
    names[`#${key}`] = key;
    values[`:${key}`] = value;
    setClauses.push(`#${key} = :${key}`);
  }

  // plantedAt is part of the GSI1 sort key — recompute it on a change.
  if (fields.plantedAt && fields.plantedAt !== existing.plantedAt) {
    names["#gsi1sk"] = "gsi1sk";
    values[":gsi1sk"] = `${fields.plantedAt}#${id}`;
    setClauses.push("#gsi1sk = :gsi1sk");
  }

  const result = await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: plantingKey(id),
    UpdateExpression: `SET ${setClauses.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ConditionExpression: "attribute_exists(pk)",
    ReturnValues: "ALL_NEW",
  }));
  return result.Attributes;
}

export async function deletePlanting(id) {
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: plantingKey(id),
      ConditionExpression: "attribute_exists(pk)",
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || err?.name === "ConditionalCheckFailedException") {
      throw new NotFoundError("planting", id);
    }
    throw err;
  }
}
