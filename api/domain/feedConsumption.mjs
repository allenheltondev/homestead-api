import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, ddb } from "../services/ddb.mjs";
import { NotFoundError } from "../services/errors.mjs";
import { newId } from "../services/id.mjs";
import { nowIso, yyyymm } from "../services/time.mjs";

// Feed consumption (usage) data access. Single-table keys (see
// docs/DATA_MODEL.md):
//   pk = FEEDUSE#<yyyy-mm>     (month bucket derived from usedAt)
//   sk = USE#<ts>#<id>         (ts = usedAt ISO; id = ULID)
//
// Mirrors the feed-purchase / egg-collection domains. Every read here is a
// GetItem or a Query on the base table -- there are NO Scans. Range listing
// fans out one Query per month partition in the window; DELETE resolves the
// row's key from an id-addressable pointer item.

function useKey(month, ts, id) {
  return { pk: `FEEDUSE#${month}`, sk: `USE#${ts}#${id}` };
}

// Id-addressable pointer key. Lets DELETE resolve a usage record's base-table
// key (pk/sk) from the bare {id} path param without a Scan -- the same trick
// feed purchases and egg collections use.
function pointerKey(id) {
  return { pk: `FEEDUSEID#${id}`, sk: "POINTER" };
}

// Builds the table row from validated fields. The month bucket derives from
// usedAt, so the same timestamp drives the pk and the sk ts segment.
export function buildFeedConsumptionItem(fields) {
  const id = newId();
  const ts = fields.usedAt;
  const month = yyyymm(ts);
  const createdAt = nowIso();

  return {
    ...useKey(month, ts, id),
    entity: "FeedConsumption",
    id,
    feedType: fields.feedType,
    lbs: fields.lbs,
    usedAt: ts,
    createdAt,
  };
}

export async function createFeedConsumption(fields) {
  const item = buildFeedConsumptionItem(fields);

  // Write the usage row plus an id-addressable pointer atomically. The pointer
  // carries the real pk/sk so DELETE (which only gets {id}) can resolve the
  // base-table key without a Scan.
  const pointer = {
    ...pointerKey(item.id),
    entity: "FeedConsumptionPointer",
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

// Returns the list of YYYY-MM buckets from fromTs..toTs inclusive. Used to
// fan out one Query per month partition instead of a Scan. Falls back to the
// current month when neither bound is given so an unfiltered list still hits
// a bounded set of partitions rather than scanning.
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

// Query one month partition for USE# rows, optionally bounded by a ts range
// on the sort key and filtered by feedType. The sort-key range uses the
// `USE#<ts>` prefix so `between` works on the composite key.
async function queryMonth(month, { fromTs, toTs, type }) {
  const values = { ":pk": `FEEDUSE#${month}` };
  let keyCondition = "pk = :pk";

  if (fromTs || toTs) {
    // `~` sorts after `#` and any ts/id, so it caps the upper bound to the
    // whole `USE#<toTs>...` group when only a ts (no id) is known.
    const lower = `USE#${fromTs ?? ""}`;
    const upper = `USE#${toTs ?? "￿"}~`;
    keyCondition += " AND sk BETWEEN :lo AND :hi";
    values[":lo"] = lower;
    values[":hi"] = upper;
  } else {
    keyCondition += " AND begins_with(sk, :prefix)";
    values[":prefix"] = "USE#";
  }

  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: values,
  };

  // Filter feedType within the month partitions (the base table has no
  // by-type index for usage, so a type filter stays a partition-scoped
  // FilterExpression, never a Scan).
  if (type) {
    params.FilterExpression = "feedType = :type";
    values[":type"] = type;
  }

  return queryAll(params);
}

// Drains pagination so callers get every matching row.
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

// Lists feed consumption records for the given filters, sorted
// chronologically. A range fans out one Query per month partition; an
// optional type is filtered within the partitions. No Scans in any branch.
export async function listFeedConsumption({ fromTs, toTs, type } = {}) {
  const months = monthsInRange(fromTs, toTs);
  const perMonth = await Promise.all(
    months.map((m) => queryMonth(m, { fromTs, toTs, type })),
  );
  const items = perMonth.flat();
  items.sort((a, b) => a.usedAt.localeCompare(b.usedAt));
  return items;
}

// Deletes a usage record by its bare {id}, scan-free. The base-table key is
// pk=FEEDUSE#<yyyy-mm> / sk=USE#<ts>#<id>, so resolving a row needs the month
// partition AND the ts -- neither is recoverable from the id. create() writes
// an id-addressable pointer (pk=FEEDUSEID#<id>) holding the real pk/sk;
// DELETE does a GetItem on that pointer, deletes the row + pointer together,
// and stays a pure key lookup.
export async function deleteFeedConsumption(id) {
  const pointerResult = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: pointerKey(id),
  }));
  const pointer = pointerResult.Item;
  if (!pointer) {
    throw new NotFoundError("feed consumption", id);
  }

  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      { Delete: { TableName: TABLE_NAME, Key: { pk: pointer.targetPk, sk: pointer.targetSk } } },
      { Delete: { TableName: TABLE_NAME, Key: pointerKey(id) } },
    ],
  }));

  return { pk: pointer.targetPk, sk: pointer.targetSk };
}
