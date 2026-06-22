import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, ddb } from "../services/ddb.mjs";
import { NotFoundError } from "../services/errors.mjs";
import { newId } from "../services/id.mjs";
import { nowIso, yyyymm } from "../services/time.mjs";

// Sales record data access. Single-table keys (see docs/DATA_MODEL.md):
//   pk = SALE#<yyyy-mm>    (month bucket derived from soldAt)
//   sk = SALE#<ts>#<id>    (ts = soldAt ISO; id = ULID)
//
// Mirrors the egg-collection / feed-purchase domains. Every read here is a
// GetItem or a Query on the base table -- there are NO Scans. Range listing
// fans out one Query per month partition in the window; DELETE resolves the
// row's key from an id-addressable pointer item (pk = SALEID#<id>).

function saleKey(month, ts, id) {
  return { pk: `SALE#${month}`, sk: `SALE#${ts}#${id}` };
}

function pointerKey(id) {
  return { pk: `SALEID#${id}`, sk: "POINTER" };
}

export function buildSaleItem(fields) {
  const id = newId();
  const ts = fields.soldAt;
  const month = yyyymm(ts);
  const createdAt = nowIso();

  return {
    ...saleKey(month, ts, id),
    entity: "Sale",
    id,
    item: fields.item,
    amount: fields.amount,
    // Optional quantity; dropped by the marshaller when absent.
    quantity: fields.quantity,
    soldAt: ts,
    createdAt,
  };
}

export async function createSale(fields) {
  const item = buildSaleItem(fields);

  const pointer = {
    ...pointerKey(item.id),
    entity: "SalePointer",
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

// Returns the list of YYYY-MM buckets from fromTs..toTs inclusive. Falls back
// to the current month when neither bound is given.
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

async function queryMonth(month, { fromTs, toTs }) {
  const values = { ":pk": `SALE#${month}` };
  let keyCondition = "pk = :pk";

  if (fromTs || toTs) {
    const lower = `SALE#${fromTs ?? ""}`;
    const upper = `SALE#${toTs ?? "￿"}~`;
    keyCondition += " AND sk BETWEEN :lo AND :hi";
    values[":lo"] = lower;
    values[":hi"] = upper;
  } else {
    keyCondition += " AND begins_with(sk, :prefix)";
    values[":prefix"] = "SALE#";
  }

  return queryAll({
    TableName: TABLE_NAME,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: values,
  });
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

// Lists sales for the given date window, sorted chronologically. A range fans
// out one Query per month partition; no Scans in any branch.
export async function listSales({ fromTs, toTs } = {}) {
  const months = monthsInRange(fromTs, toTs);
  const perMonth = await Promise.all(
    months.map((m) => queryMonth(m, { fromTs, toTs })),
  );
  const items = perMonth.flat();
  items.sort((a, b) => a.soldAt.localeCompare(b.soldAt));
  return items;
}

// Deletes a sale by its bare {id}, scan-free, via the id-addressable pointer.
export async function deleteSale(id) {
  const pointerResult = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: pointerKey(id),
  }));
  const pointer = pointerResult.Item;
  if (!pointer) {
    throw new NotFoundError("sale", id);
  }

  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      { Delete: { TableName: TABLE_NAME, Key: { pk: pointer.targetPk, sk: pointer.targetSk } } },
      { Delete: { TableName: TABLE_NAME, Key: pointerKey(id) } },
    ],
  }));

  return { pk: pointer.targetPk, sk: pointer.targetSk };
}
