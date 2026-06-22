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

// Incubation batch data access. Single-table keys (see docs/DATA_MODEL.md):
//   pk = INCUBATION#<id>   sk = METADATA
//   gsi1pk = INCUBATION    gsi1sk = <setAt>    (collection-partition listing)
//
// The collection-partition GSI lets "list all batches" be a single GSI1 Query
// (like pastures) -- there are NO Scans. Each batch is a single metadata item.

const INCUBATION_PARTITION = "INCUBATION";

// Days from set to expected hatch by species. Default 21 (chicken).
const INCUBATION_DAYS = {
  chicken: 21,
  turkey: 28,
  goose: 30,
  duck: 28,
};
const DEFAULT_INCUBATION_DAYS = 21;

// Expected hatch days for a species (defaulting to 21). Exported so validation
// + stats share the same table.
export function incubationDaysFor(species) {
  return INCUBATION_DAYS[species] ?? DEFAULT_INCUBATION_DAYS;
}

// expectedHatchAt = setAt + incubationDays(species), as an ISO timestamp.
export function computeExpectedHatchAt(species, setAt) {
  const days = incubationDaysFor(species);
  return new Date(new Date(setAt).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function metadataKey(id) {
  return { pk: `INCUBATION#${id}`, sk: "METADATA" };
}

export function buildIncubationItem(fields) {
  const id = newId();
  const now = nowIso();
  const expectedHatchAt = computeExpectedHatchAt(fields.species, fields.setAt);

  return {
    ...metadataKey(id),
    entity: "Incubation",
    id,
    species: fields.species,
    count: fields.count,
    setAt: fields.setAt,
    expectedHatchAt,
    status: "incubating",
    gsi1pk: INCUBATION_PARTITION,
    gsi1sk: fields.setAt,
    createdAt: now,
    updatedAt: now,
  };
}

export async function createIncubationBatch(fields) {
  const item = buildIncubationItem(fields);
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: "attribute_not_exists(pk)",
  }));
  return item;
}

export async function getIncubationBatch(id) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: metadataKey(id),
  }));
  if (!result.Item) {
    throw new NotFoundError("incubation batch", id);
  }
  return result.Item;
}

// Lists all batches via GSI1 (gsi1pk = INCUBATION), chronological by setAt.
export async function listIncubationBatches() {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": INCUBATION_PARTITION },
  }));
  return result.Items ?? [];
}

// PATCH /incubation-batches/{id} -- records a hatch: sets hatchedCount and the
// resulting status (default "hatched"). Conditional on existence (404 else).
export async function recordHatch(id, { hatchedCount, status }) {
  const now = nowIso();
  const names = {
    "#hatchedCount": "hatchedCount",
    "#status": "status",
    "#updatedAt": "updatedAt",
  };
  const values = {
    ":hatchedCount": hatchedCount,
    ":status": status ?? "hatched",
    ":updatedAt": now,
  };

  try {
    const result = await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: metadataKey(id),
      UpdateExpression:
        "SET #hatchedCount = :hatchedCount, #status = :status, #updatedAt = :updatedAt",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(pk)",
      ReturnValues: "ALL_NEW",
    }));
    return result.Attributes;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || err?.name === "ConditionalCheckFailedException") {
      throw new NotFoundError("incubation batch", id);
    }
    throw err;
  }
}

export async function deleteIncubationBatch(id) {
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: metadataKey(id),
      ConditionExpression: "attribute_exists(pk)",
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || err?.name === "ConditionalCheckFailedException") {
      throw new NotFoundError("incubation batch", id);
    }
    throw err;
  }
}
