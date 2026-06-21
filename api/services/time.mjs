// Time helpers. Everything stored in the table uses ISO-8601 UTC
// timestamps so string comparison on a sort key matches chronological
// order. `yyyymm` powers the monthly partition keys (feed purchases,
// lifecycle-event buckets) called out in the data model.

export function nowIso() {
  return new Date().toISOString();
}

export function toIso(value = new Date()) {
  return new Date(value).toISOString();
}

// "2026-06" for a Date or ISO string. Used to build FEED#<yyyy-mm> and
// EVENT#<TYPE>#<yyyy-mm> partition keys.
export function yyyymm(value = new Date()) {
  const d = new Date(value);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
