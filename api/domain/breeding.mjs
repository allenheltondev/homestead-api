import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, ddb } from "../services/ddb.mjs";
import { NotFoundError } from "../services/errors.mjs";
import { newId } from "../services/id.mjs";
import { nowIso } from "../services/time.mjs";

// Breeding record data access. Single-table keys (see docs/DATA_MODEL.md):
//   pk = BREEDING#<id>   sk = METADATA
//   gsi1pk = BREEDING    gsi1sk = <expectedDueAt>   (collection-partition list)
//
// The collection-partition GSI keyed by expectedDueAt lets "list breedings"
// (and "due within N days") be a single GSI1 Query -- there are NO Scans.

const BREEDING_PARTITION = "BREEDING";

// Gestation days by species. Default 150 (goat).
const GESTATION_DAYS = {
  goat: 150,
  sheep: 147,
  pig: 114,
};
const DEFAULT_GESTATION_DAYS = 150;

export function gestationDaysFor(species) {
  return GESTATION_DAYS[species] ?? DEFAULT_GESTATION_DAYS;
}

// expectedDueAt = bredAt + gestation(species), as an ISO timestamp.
export function computeExpectedDueAt(species, bredAt) {
  const days = gestationDaysFor(species);
  return new Date(new Date(bredAt).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function metadataKey(id) {
  return { pk: `BREEDING#${id}`, sk: "METADATA" };
}

export function buildBreedingItem(fields) {
  const id = newId();
  const now = nowIso();
  const expectedDueAt = computeExpectedDueAt(fields.species, fields.bredAt);

  return {
    ...metadataKey(id),
    entity: "Breeding",
    id,
    species: fields.species,
    damId: fields.damId,
    // Optional sire; dropped by the marshaller when absent.
    sireId: fields.sireId,
    bredAt: fields.bredAt,
    expectedDueAt,
    gsi1pk: BREEDING_PARTITION,
    gsi1sk: expectedDueAt,
    createdAt: now,
    updatedAt: now,
  };
}

export async function createBreeding(fields) {
  const item = buildBreedingItem(fields);
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: "attribute_not_exists(pk)",
  }));
  return item;
}

export async function getBreeding(id) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: metadataKey(id),
  }));
  if (!result.Item) {
    throw new NotFoundError("breeding", id);
  }
  return result.Item;
}

// Lists all breedings via GSI1 (gsi1pk = BREEDING), ordered by expectedDueAt.
export async function listBreedings() {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": BREEDING_PARTITION },
  }));
  return result.Items ?? [];
}

// Lists breedings due within [now, now + withinDays] via a single GSI1 Query
// range-bounded on gsi1sk (= expectedDueAt). No Scan.
export async function listBreedingsDue(withinDays, now = new Date()) {
  const start = new Date(now).toISOString();
  const end = new Date(new Date(now).getTime() + withinDays * 24 * 60 * 60 * 1000).toISOString();

  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk AND gsi1sk BETWEEN :lo AND :hi",
    ExpressionAttributeValues: {
      ":pk": BREEDING_PARTITION,
      ":lo": start,
      ":hi": end,
    },
  }));
  return result.Items ?? [];
}

export async function deleteBreeding(id) {
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: metadataKey(id),
      ConditionExpression: "attribute_exists(pk)",
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || err?.name === "ConditionalCheckFailedException") {
      throw new NotFoundError("breeding", id);
    }
    throw err;
  }
}
