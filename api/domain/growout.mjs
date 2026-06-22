import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, ddb } from "../services/ddb.mjs";
import { NotFoundError } from "../services/errors.mjs";
import { newId } from "../services/id.mjs";
import { nowIso } from "../services/time.mjs";

// Grow-out batch data access. Single-table keys (see docs/DATA_MODEL.md):
//   pk = GROWOUT#<id>   sk = METADATA
//   gsi1pk = GROWOUT    gsi1sk = <startedAt>   (collection-partition listing)
//
// The collection-partition GSI lets "list grow-out batches" be a single GSI1
// Query -- there are NO Scans. A batch is a single metadata item; processing
// updates the same item with the yield fields.

const GROWOUT_PARTITION = "GROWOUT";

function metadataKey(id) {
  return { pk: `GROWOUT#${id}`, sk: "METADATA" };
}

export function buildGrowoutItem(fields) {
  const id = newId();
  const now = nowIso();

  return {
    ...metadataKey(id),
    entity: "Growout",
    id,
    species: fields.species,
    count: fields.count,
    purpose: fields.purpose,
    startedAt: fields.startedAt,
    status: "raising",
    gsi1pk: GROWOUT_PARTITION,
    gsi1sk: fields.startedAt,
    createdAt: now,
    updatedAt: now,
  };
}

export async function createGrowout(fields) {
  const item = buildGrowoutItem(fields);
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: "attribute_not_exists(pk)",
  }));
  return item;
}

export async function getGrowout(id) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: metadataKey(id),
  }));
  if (!result.Item) {
    throw new NotFoundError("growout", id);
  }
  return result.Item;
}

// Lists all grow-out batches via GSI1 (gsi1pk = GROWOUT), by startedAt.
export async function listGrowouts() {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": GROWOUT_PARTITION },
  }));
  return result.Items ?? [];
}

// PATCH /growout/{id}/process -- records processing: processedAt, dressed
// weight, and processed count; flips status to "processed". 404 if missing.
export async function recordProcessing(id, fields) {
  const now = nowIso();
  const names = {
    "#status": "status",
    "#processedAt": "processedAt",
    "#dressedWeightLbsTotal": "dressedWeightLbsTotal",
    "#processedCount": "processedCount",
    "#updatedAt": "updatedAt",
  };
  const values = {
    ":status": "processed",
    ":processedAt": fields.processedAt,
    ":dressedWeightLbsTotal": fields.dressedWeightLbsTotal,
    ":processedCount": fields.processedCount,
    ":updatedAt": now,
  };

  try {
    const result = await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: metadataKey(id),
      UpdateExpression:
        "SET #status = :status, #processedAt = :processedAt, "
        + "#dressedWeightLbsTotal = :dressedWeightLbsTotal, "
        + "#processedCount = :processedCount, #updatedAt = :updatedAt",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(pk)",
      ReturnValues: "ALL_NEW",
    }));
    return result.Attributes;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || err?.name === "ConditionalCheckFailedException") {
      throw new NotFoundError("growout", id);
    }
    throw err;
  }
}

export async function deleteGrowout(id) {
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: metadataKey(id),
      ConditionExpression: "attribute_exists(pk)",
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || err?.name === "ConditionalCheckFailedException") {
      throw new NotFoundError("growout", id);
    }
    throw err;
  }
}
