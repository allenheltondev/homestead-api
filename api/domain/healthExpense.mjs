import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, ddb } from "../services/ddb.mjs";
import { NotFoundError } from "../services/errors.mjs";
import { newId } from "../services/id.mjs";
import { nowIso, yyyymm } from "../services/time.mjs";

// Health expense data access. Single-table keys (see docs/DATA_MODEL.md):
//   pk = HEALTHEXP#<yyyy-mm>   (month bucket derived from incurredAt)
//   sk = EXP#<ts>#<id>         (ts = incurredAt ISO; id = ULID)
//
// Mirrors the feed-consumption / egg-collection domains. Every read here is a
// GetItem or a Query on the base table -- there are NO Scans. Range listing
// fans out one Query per month partition in the window; DELETE resolves the
// row's key from an id-addressable pointer item.

function expenseKey(month, ts, id) {
  return { pk: `HEALTHEXP#${month}`, sk: `EXP#${ts}#${id}` };
}

// Id-addressable pointer key. Lets DELETE resolve an expense record's
// base-table key (pk/sk) from the bare {id} path param without a Scan -- the
// same trick feed consumption + egg collections use.
function pointerKey(id) {
  return { pk: `HEALTHEXPID#${id}`, sk: "POINTER" };
}

// Builds the table row from validated fields. The month bucket derives from
// incurredAt, so the same timestamp drives the pk and the sk ts segment.
export function buildHealthExpenseItem(fields) {
  const id = newId();
  const ts = fields.incurredAt;
  const month = yyyymm(ts);
  const createdAt = nowIso();

  return {
    ...expenseKey(month, ts, id),
    entity: "HealthExpense",
    id,
    category: fields.category,
    cost: fields.cost,
    // Optional fields are dropped by the marshaller when undefined.
    animalRef: fields.animalRef,
    note: fields.note,
    incurredAt: ts,
    createdAt,
  };
}

export async function createHealthExpense(fields) {
  const item = buildHealthExpenseItem(fields);

  // Write the expense row plus an id-addressable pointer atomically. The
  // pointer carries the real pk/sk so DELETE (which only gets {id}) can
  // resolve the base-table key without a Scan.
  const pointer = {
    ...pointerKey(item.id),
    entity: "HealthExpensePointer",
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

// Query one month partition for EXP# rows, optionally bounded by a ts range
// on the sort key and filtered by category. The sort-key range uses the
// `EXP#<ts>` prefix so `between` works on the composite key.
async function queryMonth(month, { fromTs, toTs, category }) {
  const values = { ":pk": `HEALTHEXP#${month}` };
  let keyCondition = "pk = :pk";

  if (fromTs || toTs) {
    // `~` sorts after `#` and any ts/id, so it caps the upper bound to the
    // whole `EXP#<toTs>...` group when only a ts (no id) is known.
    const lower = `EXP#${fromTs ?? ""}`;
    const upper = `EXP#${toTs ?? "￿"}~`;
    keyCondition += " AND sk BETWEEN :lo AND :hi";
    values[":lo"] = lower;
    values[":hi"] = upper;
  } else {
    keyCondition += " AND begins_with(sk, :prefix)";
    values[":prefix"] = "EXP#";
  }

  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: values,
  };

  // Filter category within the month partitions (the base table has no
  // by-category index, so a category filter stays a partition-scoped
  // FilterExpression, never a Scan).
  if (category) {
    params.FilterExpression = "category = :category";
    values[":category"] = category;
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

// Lists health expenses for the given filters, sorted chronologically. A
// range fans out one Query per month partition; an optional category is
// filtered within the partitions. No Scans in any branch.
export async function listHealthExpenses({ fromTs, toTs, category } = {}) {
  const months = monthsInRange(fromTs, toTs);
  const perMonth = await Promise.all(
    months.map((m) => queryMonth(m, { fromTs, toTs, category })),
  );
  const items = perMonth.flat();
  items.sort((a, b) => a.incurredAt.localeCompare(b.incurredAt));
  return items;
}

// Deletes an expense record by its bare {id}, scan-free. The base-table key is
// pk=HEALTHEXP#<yyyy-mm> / sk=EXP#<ts>#<id>, so resolving a row needs the month
// partition AND the ts -- neither is recoverable from the id. create() writes
// an id-addressable pointer (pk=HEALTHEXPID#<id>) holding the real pk/sk;
// DELETE does a GetItem on that pointer, deletes the row + pointer together,
// and stays a pure key lookup.
export async function deleteHealthExpense(id) {
  const pointerResult = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: pointerKey(id),
  }));
  const pointer = pointerResult.Item;
  if (!pointer) {
    throw new NotFoundError("health expense", id);
  }

  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      { Delete: { TableName: TABLE_NAME, Key: { pk: pointer.targetPk, sk: pointer.targetSk } } },
      { Delete: { TableName: TABLE_NAME, Key: pointerKey(id) } },
    ],
  }));

  return { pk: pointer.targetPk, sk: pointer.targetSk };
}
