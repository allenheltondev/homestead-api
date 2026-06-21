import { ulid } from "ulid";

// ULIDs are lexicographically sortable by creation time, so using them
// as entity ids keeps "newest first" ordering working on the sort key
// without a separate timestamp attribute.
export function newId() {
  return ulid();
}
