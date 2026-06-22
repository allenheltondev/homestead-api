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

// Care task data access. Single-table keys (see docs/DATA_MODEL.md):
//   pk = CARETASK#<id>   sk = METADATA
//   gsi1pk = CARETASK    gsi1sk = <nextDueAt>   (collection-partition listing)
//
// The collection-partition GSI keyed by nextDueAt lets "list tasks ordered by
// next due" (and "due within N days") be a single GSI1 Query -- there are NO
// Scans. A task is a single metadata item; completing or editing it rewrites
// gsi1sk so the ordering stays consistent.

const CARETASK_PARTITION = "CARETASK";

function metadataKey(id) {
  return { pk: `CARETASK#${id}`, sk: "METADATA" };
}

// nextDueAt from a base timestamp + cadence days, as an ISO timestamp.
export function computeNextDueAt(fromTs, cadenceDays) {
  return new Date(new Date(fromTs).getTime() + cadenceDays * 24 * 60 * 60 * 1000).toISOString();
}

export function buildCareTaskItem(fields) {
  const id = newId();
  const now = nowIso();
  // First due date is cadence days from creation unless an explicit nextDueAt
  // was supplied by validation.
  const nextDueAt = fields.nextDueAt ?? computeNextDueAt(now, fields.cadenceDays);

  return {
    ...metadataKey(id),
    entity: "CareTask",
    id,
    title: fields.title,
    category: fields.category,
    // Optional target (animal/pasture/coop reference); dropped when absent.
    target: fields.target,
    cadenceDays: fields.cadenceDays,
    nextDueAt,
    gsi1pk: CARETASK_PARTITION,
    gsi1sk: nextDueAt,
    createdAt: now,
    updatedAt: now,
  };
}

export async function createCareTask(fields) {
  const item = buildCareTaskItem(fields);
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: "attribute_not_exists(pk)",
  }));
  return item;
}

export async function getCareTask(id) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: metadataKey(id),
  }));
  if (!result.Item) {
    throw new NotFoundError("care task", id);
  }
  return result.Item;
}

// Lists all care tasks via GSI1 (gsi1pk = CARETASK), ordered by nextDueAt.
export async function listCareTasks() {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": CARETASK_PARTITION },
    ScanIndexForward: true, // soonest-due first
  }));
  return result.Items ?? [];
}

// Lists tasks due within [..., now + withinDays] via a single GSI1 Query
// upper-bounded on gsi1sk (= nextDueAt). Overdue tasks (nextDueAt in the past)
// are included since the lower bound is open. No Scan.
export async function listCareTasksDue(withinDays, now = new Date()) {
  const end = new Date(new Date(now).getTime() + withinDays * 24 * 60 * 60 * 1000).toISOString();

  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk AND gsi1sk <= :hi",
    ExpressionAttributeValues: {
      ":pk": CARETASK_PARTITION,
      ":hi": end,
    },
    ScanIndexForward: true,
  }));
  return result.Items ?? [];
}

// PATCH /care-tasks/{id} -- edits title/category/target/cadenceDays. When
// cadenceDays changes we leave nextDueAt as-is (completion drives the schedule);
// callers can complete to re-anchor. 404 when the task is missing.
export async function updateCareTask(id, fields) {
  const now = nowIso();
  const setClauses = ["#updatedAt = :updatedAt"];
  const names = { "#updatedAt": "updatedAt" };
  const values = { ":updatedAt": now };

  for (const [key, value] of Object.entries(fields)) {
    names[`#${key}`] = key;
    values[`:${key}`] = value;
    setClauses.push(`#${key} = :${key}`);
  }

  try {
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
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || err?.name === "ConditionalCheckFailedException") {
      throw new NotFoundError("care task", id);
    }
    throw err;
  }
}

// POST /care-tasks/{id}/complete -- sets lastDoneAt = now and advances
// nextDueAt = now + cadenceDays, rewriting gsi1sk so the ordered listing stays
// consistent. Reads the task first to learn its cadence. 404 when missing.
export async function completeCareTask(id, now = new Date()) {
  const task = await getCareTask(id);
  const nowIsoTs = new Date(now).toISOString();
  const nextDueAt = computeNextDueAt(now, task.cadenceDays);

  const result = await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: metadataKey(id),
    UpdateExpression:
      "SET #lastDoneAt = :lastDoneAt, #nextDueAt = :nextDueAt, "
      + "#gsi1sk = :gsi1sk, #updatedAt = :updatedAt",
    ExpressionAttributeNames: {
      "#lastDoneAt": "lastDoneAt",
      "#nextDueAt": "nextDueAt",
      "#gsi1sk": "gsi1sk",
      "#updatedAt": "updatedAt",
    },
    ExpressionAttributeValues: {
      ":lastDoneAt": nowIsoTs,
      ":nextDueAt": nextDueAt,
      ":gsi1sk": nextDueAt,
      ":updatedAt": nowIsoTs,
    },
    ConditionExpression: "attribute_exists(pk)",
    ReturnValues: "ALL_NEW",
  }));
  return result.Attributes;
}

export async function deleteCareTask(id) {
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: metadataKey(id),
      ConditionExpression: "attribute_exists(pk)",
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || err?.name === "ConditionalCheckFailedException") {
      throw new NotFoundError("care task", id);
    }
    throw err;
  }
}
