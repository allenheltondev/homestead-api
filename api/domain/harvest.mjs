import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, ddb } from "../services/ddb.mjs";
import { NotFoundError } from "../services/errors.mjs";
import { newId } from "../services/id.mjs";
import { nowIso, yyyymm } from "../services/time.mjs";

// Harvest-log data access. Single-table keys (see docs/DATA_MODEL.md):
//   pk = HARVEST#<yyyy-mm>     (month bucket derived from harvestedAt)
//   sk = LOG#<ts>#<id>         (ts = harvestedAt ISO; id = ULID)
//
// Every read here is a GetItem or a Query on the base table -- there are NO
// Scans. Range listing fans out one Query per month partition in the window;
// id-addressable operations (DELETE, GRN field updates) resolve the row's
// base-table key from a pointer item, the same trick eggs/feed use.

function harvestKey(month, ts, id) {
  return { pk: `HARVEST#${month}`, sk: `LOG#${ts}#${id}` };
}

// Id-addressable pointer key. Lets DELETE + the GRN publish endpoints resolve
// a log's base-table key (pk/sk) from the bare {id} path param without a Scan.
function pointerKey(id) {
  return { pk: `HARVESTID#${id}`, sk: "POINTER" };
}

// Builds the table row from validated fields. The month bucket derives from
// harvestedAt, so the same timestamp drives the pk and the sk ts segment.
export function buildHarvestItem(fields) {
  const id = newId();
  const ts = fields.harvestedAt;
  const month = yyyymm(ts);
  const createdAt = nowIso();

  return {
    ...harvestKey(month, ts, id),
    entity: "HarvestLog",
    id,
    cropName: fields.cropName,
    variety: fields.variety,
    quantity: fields.quantity,
    unit: fields.unit,
    harvestedAt: ts,
    // GRN linkage: the grower-crop (crop library) id this harvest came from,
    // and the GRN garden-bed id it was harvested from. Both optional — a
    // quick log can stay unlinked until the grower wants to share it.
    cropLibraryId: fields.cropLibraryId,
    grnBedId: fields.grnBedId,
    surplus: fields.surplus,
    createdAt,
  };
}

export async function createHarvestLog(fields) {
  const item = buildHarvestItem(fields);

  // Write the log row plus an id-addressable pointer atomically. The pointer
  // carries the real pk/sk so DELETE + the GRN publish endpoints (which only
  // get {id}) can resolve the base-table key without a Scan.
  const pointer = {
    ...pointerKey(item.id),
    entity: "HarvestLogPointer",
    id: item.id,
    targetPk: item.pk,
    targetSk: item.sk,
  };

  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: TABLE_NAME,
          Item: item,
          ConditionExpression: "attribute_not_exists(sk)",
        },
      },
      {
        Put: {
          TableName: TABLE_NAME,
          Item: pointer,
          ConditionExpression: "attribute_not_exists(sk)",
        },
      },
    ],
  }));

  return item;
}

// Returns the list of YYYY-MM buckets from fromTs..toTs inclusive so a range
// list fans out one Query per month partition instead of a Scan. Falls back to
// the current month when neither bound is given.
export function monthsInRange(fromTs, toTs) {
  const start = fromTs ? new Date(fromTs) : new Date();
  const end = toTs ? new Date(toTs) : new Date();

  let year = start.getUTCFullYear();
  let month = start.getUTCMonth(); // 0-based
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();

  const months = [];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month + 1).padStart(2, "0")}`);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return months;
}

async function queryAll(params) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await ddb.send(new QueryCommand({ ...params, ExclusiveStartKey }));
    if (result.Items) items.push(...result.Items);
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// Query one month partition for LOG# rows, optionally bounded by a ts range on
// the sort key. Mirrors the egg-collection range fan-out.
async function queryMonth(month, { fromTs, toTs }) {
  const values = { ":pk": `HARVEST#${month}` };
  let keyCondition = "pk = :pk";

  if (fromTs || toTs) {
    const lower = `LOG#${fromTs ?? ""}`;
    const upper = `LOG#${toTs ?? "￿"}~`;
    keyCondition += " AND sk BETWEEN :lo AND :hi";
    values[":lo"] = lower;
    values[":hi"] = upper;
  } else {
    keyCondition += " AND begins_with(sk, :prefix)";
    values[":prefix"] = "LOG#";
  }

  return queryAll({
    TableName: TABLE_NAME,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: values,
  });
}

// Lists harvest logs for the given date window, sorted chronologically. A
// range fans out one Query per month partition; no Scans in any branch.
export async function listHarvestLogs({ fromTs, toTs } = {}) {
  const months = monthsInRange(fromTs, toTs);
  const perMonth = await Promise.all(
    months.map((m) => queryMonth(m, { fromTs, toTs })),
  );
  const items = perMonth.flat();
  items.sort((a, b) => a.harvestedAt.localeCompare(b.harvestedAt));
  return items;
}

// Resolves a harvest log row from its bare {id} via the id pointer (GetItem on
// the pointer, then GetItem on the resolved key). Scan-free. Throws NotFound
// when either lookup misses.
export async function getHarvestLog(id) {
  const pointerResult = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: pointerKey(id),
  }));
  const pointer = pointerResult.Item;
  if (!pointer) {
    throw new NotFoundError("harvest log", id);
  }
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: pointer.targetPk, sk: pointer.targetSk },
  }));
  if (!result.Item) {
    throw new NotFoundError("harvest log", id);
  }
  return result.Item;
}

// Deletes a log by its bare {id}, scan-free (pointer GetItem -> delete row +
// pointer). Mirrors deleteEggCollection.
export async function deleteHarvestLog(id) {
  const pointerResult = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: pointerKey(id),
  }));
  const pointer = pointerResult.Item;
  if (!pointer) {
    throw new NotFoundError("harvest log", id);
  }

  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      { Delete: { TableName: TABLE_NAME, Key: { pk: pointer.targetPk, sk: pointer.targetSk } } },
      { Delete: { TableName: TABLE_NAME, Key: pointerKey(id) } },
    ],
  }));

  return { pk: pointer.targetPk, sk: pointer.targetSk };
}

// Updates the GRN linkage fields on a harvest log (used by the publish
// endpoints + the daily claim-status sync). Resolves the base-table key via
// the id pointer first, so it stays scan-free. Passing a field value of `null`
// removes it (DynamoDB REMOVE); undefined leaves it untouched.
export async function updateHarvestGrnFields(id, { grnListingId, grnStatus } = {}) {
  const log = await getHarvestLog(id);
  const key = { pk: log.pk, sk: log.sk };

  const setClauses = [];
  const removeClauses = [];
  const names = {};
  const values = {};

  const apply = (attr, value) => {
    names[`#${attr}`] = attr;
    if (value === null) {
      removeClauses.push(`#${attr}`);
    } else {
      setClauses.push(`#${attr} = :${attr}`);
      values[`:${attr}`] = value;
    }
  };

  if (grnListingId !== undefined) apply("grnListingId", grnListingId);
  if (grnStatus !== undefined) apply("grnStatus", grnStatus);

  if (setClauses.length === 0 && removeClauses.length === 0) {
    return log;
  }

  const parts = [];
  if (setClauses.length) parts.push(`SET ${setClauses.join(", ")}`);
  if (removeClauses.length) parts.push(`REMOVE ${removeClauses.join(", ")}`);

  const result = await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: key,
    UpdateExpression: parts.join(" "),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
    ReturnValues: "ALL_NEW",
  }));
  return result.Attributes;
}

// Lists every harvest log currently linked to a GRN listing (grnListingId
// set). Used by the daily claim-status sync. Reads the month partitions across
// a bounded lookback window (no Scan) and filters in code.
export async function listLinkedHarvestLogs({ fromTs, toTs } = {}) {
  const logs = await listHarvestLogs({ fromTs, toTs });
  return logs.filter((l) => typeof l.grnListingId === "string" && l.grnListingId.length > 0);
}
