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

// Garden bed records live at:
//   pk = BED#<id>, sk = METADATA
//
// They also carry gsi1pk = "BED" with gsi1sk = <name> so the
// "list all beds, alphabetical" view is a single Query on GSI1 (a
// collection-partition GSI, mirroring pastures). No Scans.

const BED_PARTITION = "BED";

export function bedKey(id) {
  return { pk: `BED#${id}`, sk: "METADATA" };
}

export async function createBed(fields) {
  const id = newId();
  const now = nowIso();
  const item = {
    ...bedKey(id),
    entity: "Bed",
    id,
    name: fields.name,
    sizeSqFt: fields.sizeSqFt,
    gsi1pk: BED_PARTITION,
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

export async function getBed(id) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: bedKey(id),
  }));
  if (!result.Item) {
    throw new NotFoundError("bed", id);
  }
  return result.Item;
}

// Existence check that does not throw — used before attaching a planting so
// the right error surfaces from the planting domain.
export async function bedExists(id) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: bedKey(id),
    ProjectionExpression: "pk",
  }));
  return Boolean(result.Item);
}

// Lists all beds alphabetically by name via GSI1 (gsi1pk = BED). No Scan.
export async function listBeds({ limit, exclusiveStartKey } = {}) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": BED_PARTITION },
    ScanIndexForward: true, // alphabetical by name
    Limit: limit,
    ExclusiveStartKey: exclusiveStartKey,
  }));

  return {
    items: result.Items ?? [],
    lastEvaluatedKey: result.LastEvaluatedKey,
  };
}

// PATCH /beds/{id}. Rebuilds gsi1sk when the name changes so the alphabetical
// listing stays consistent. Only the supplied fields are written.
export async function updateBed(id, fields) {
  const existing = await getBed(id);
  const now = nowIso();

  const setClauses = ["#updatedAt = :updatedAt"];
  const names = { "#updatedAt": "updatedAt" };
  const values = { ":updatedAt": now };

  for (const [key, value] of Object.entries(fields)) {
    names[`#${key}`] = key;
    values[`:${key}`] = value;
    setClauses.push(`#${key} = :${key}`);
  }

  // name is the GSI1 sort key — recompute it on a name change.
  if (fields.name && fields.name !== existing.name) {
    names["#gsi1sk"] = "gsi1sk";
    values[":gsi1sk"] = fields.name;
    setClauses.push("#gsi1sk = :gsi1sk");
  }

  const result = await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: bedKey(id),
    UpdateExpression: `SET ${setClauses.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ConditionExpression: "attribute_exists(pk)",
    ReturnValues: "ALL_NEW",
  }));
  return result.Attributes;
}

export async function deleteBed(id) {
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: bedKey(id),
      ConditionExpression: "attribute_exists(pk)",
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || err?.name === "ConditionalCheckFailedException") {
      throw new NotFoundError("bed", id);
    }
    throw err;
  }
}
