import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, ddb } from "../services/ddb.mjs";
import { NotFoundError } from "../services/errors.mjs";
import { newId } from "../services/id.mjs";
import { nowIso, yyyymm } from "../services/time.mjs";

// Feed purchase data access. Single-table keys (see docs/DATA_MODEL.md):
//   pk     = FEED#<yyyy-mm>        (month bucket derived from purchasedAt)
//   sk     = PURCHASE#<ts>#<id>    (ts = purchasedAt ISO; id = ULID)
//   gsi1pk = FEED#<type>
//   gsi1sk = <ts>
//
// Every read here is a GetItem or a Query on the base table / GSI1 — there
// are NO Scans. Range listing fans out one Query per month partition in the
// window; the by-type listing is a single GSI1 Query.

function feedKey(month, ts, id) {
  return { pk: `FEED#${month}`, sk: `PURCHASE#${ts}#${id}` };
}

// Id-addressable pointer key. Lets DELETE resolve a purchase's base-table
// key (pk/sk) from the bare {id} path param without a Scan — see
// deleteFeedPurchase for the rationale.
function pointerKey(id) {
  return { pk: `FEEDID#${id}`, sk: "POINTER" };
}

// Builds the table row from validated fields. The month bucket is derived
// from purchasedAt, so the same timestamp drives the pk, the sk ts segment,
// and gsi1sk — keeping the three views consistent.
export function buildFeedPurchaseItem(fields) {
  const id = newId();
  const ts = fields.purchasedAt;
  const month = yyyymm(ts);
  const createdAt = nowIso();

  // Optional fields (legacy quantity/unit/vendor vs. new bag fields) are
  // dropped by the ddb marshaller when undefined, so a row only carries the
  // attributes its payload shape set.
  return {
    ...feedKey(month, ts, id),
    gsi1pk: `FEED#${fields.type}`,
    gsi1sk: ts,
    entity: "FeedPurchase",
    id,
    type: fields.type,
    feedType: fields.feedType,
    bags: fields.bags,
    bagWeightLbs: fields.bagWeightLbs,
    totalLbs: fields.totalLbs,
    quantity: fields.quantity,
    unit: fields.unit,
    cost: fields.cost,
    vendor: fields.vendor,
    purchasedAt: ts,
    createdAt,
  };
}

export async function createFeedPurchase(fields) {
  const item = buildFeedPurchaseItem(fields);

  // Write the purchase row plus an id-addressable pointer atomically. The
  // pointer carries the real pk/sk so DELETE (which only gets {id}) can
  // resolve the base-table key without a Scan.
  const pointer = {
    ...pointerKey(item.id),
    entity: "FeedPurchasePointer",
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
          // ULID collisions are effectively impossible, but the condition
          // keeps a create from silently clobbering an existing row.
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
  // Guard against an inverted range producing an unbounded loop.
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

// Query one month partition for PURCHASE# rows, optionally bounded by a
// ts range on the sort key and filtered by type. The sort-key range uses
// the `PURCHASE#<ts>` prefix so `between` works on the composite key.
async function queryMonth(month, { fromTs, toTs, type }) {
  const values = { ":pk": `FEED#${month}` };
  let keyCondition = "pk = :pk";

  if (fromTs || toTs) {
    // `~` sorts after `#` and any ts/id, so it caps the upper bound to the
    // whole `PURCHASE#<toTs>...` group when only a ts (no id) is known.
    const lower = `PURCHASE#${fromTs ?? ""}`;
    const upper = `PURCHASE#${toTs ?? "￿"}~`;
    keyCondition += " AND sk BETWEEN :lo AND :hi";
    values[":lo"] = lower;
    values[":hi"] = upper;
  } else {
    keyCondition += " AND begins_with(sk, :prefix)";
    values[":prefix"] = "PURCHASE#";
  }

  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: values,
  };

  // range + type: filter type within the month partitions (the by-type GSI
  // can't also be range-bounded by month pk, so we filter in the partition).
  if (type) {
    params.FilterExpression = "#type = :type";
    params.ExpressionAttributeNames = { "#type": "type" };
    values[":type"] = type;
  }

  return queryAll(params);
}

// Query GSI1 (gsi1pk = FEED#<type>) for purchases of one type, optionally
// bounded by date on gsi1sk (= ts). A single Query, no fan-out.
async function queryByType(type, { fromTs, toTs }) {
  const values = { ":pk": `FEED#${type}` };
  let keyCondition = "gsi1pk = :pk";

  if (fromTs && toTs) {
    keyCondition += " AND gsi1sk BETWEEN :lo AND :hi";
    values[":lo"] = fromTs;
    values[":hi"] = toTs;
  } else if (fromTs) {
    keyCondition += " AND gsi1sk >= :lo";
    values[":lo"] = fromTs;
  } else if (toTs) {
    keyCondition += " AND gsi1sk <= :hi";
    values[":hi"] = toTs;
  }

  return queryAll({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: values,
  });
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

// Lists feed purchases for the given filters, sorted chronologically.
//   - type only            -> single GSI1 Query (date-bounded on gsi1sk)
//   - range (with/without type) -> fan-out Query per month partition
// No Scans in any branch.
export async function listFeedPurchases({ fromTs, toTs, type } = {}) {
  let items;

  // Pure type lookup (no date range) is the GSI1 path. When a range is
  // present we prefer the month partitions and filter type within them, so
  // we never fall back to a Scan and the date window stays a key condition.
  const hasRange = Boolean(fromTs || toTs);
  if (type && !hasRange) {
    items = await queryByType(type, { fromTs, toTs });
  } else {
    const months = monthsInRange(fromTs, toTs);
    const perMonth = await Promise.all(
      months.map((m) => queryMonth(m, { fromTs, toTs, type })),
    );
    items = perMonth.flat();
  }

  items.sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt));
  return items;
}

// Deletes a purchase by its bare {id}, scan-free.
//
// Why the pointer item: the base-table key is
// pk=FEED#<yyyy-mm> / sk=PURCHASE#<ts>#<id>, so resolving a row needs the
// month partition AND the ts — neither is recoverable from the id. A ULID
// embeds its creation time, but purchasedAt (which drives the month bucket)
// can be backdated and differ from it, so decoding the ULID is not reliable.
// GSI1 is keyed by type+ts, not id. Rather than Scan, create() writes an
// id-addressable pointer (pk=FEEDID#<id>) holding the real pk/sk; DELETE does
// a GetItem on that pointer, deletes the row + pointer together, and stays a
// pure key lookup.
export async function deleteFeedPurchase(id) {
  const pointerResult = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: pointerKey(id),
  }));
  const pointer = pointerResult.Item;
  if (!pointer) {
    throw new NotFoundError("feed purchase", id);
  }

  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      { Delete: { TableName: TABLE_NAME, Key: { pk: pointer.targetPk, sk: pointer.targetSk } } },
      { Delete: { TableName: TABLE_NAME, Key: pointerKey(id) } },
    ],
  }));

  return { pk: pointer.targetPk, sk: pointer.targetSk };
}
