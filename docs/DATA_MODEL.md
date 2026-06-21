# Data Model

Homestead uses a **single DynamoDB table** with two global secondary
indexes. Every read is a `GetItem` or a `Query` — **there are no Scans**
(see the [no-Scan rule](./ARCHITECTURE.md#no-scan-rule)).

## Keys

| Key      | Attribute | Notes                                   |
| -------- | --------- | --------------------------------------- |
| Table PK | `pk`      | Partition key                           |
| Table SK | `sk`      | Sort key                                |
| GSI1 PK  | `gsi1pk`  | `ProjectionType: ALL`                   |
| GSI1 SK  | `gsi1sk`  |                                         |
| GSI2 PK  | `gsi2pk`  | `ProjectionType: ALL`                   |
| GSI2 SK  | `gsi2sk`  |                                         |
| TTL      | `expiresAt` | epoch seconds; auto-expiry            |
| Stream   | —         | `NEW_AND_OLD_IMAGES`                     |

Ids are ULIDs (`<id>`); timestamps (`<ts>`, `<createdAt>`) are ISO-8601
UTC strings so string ordering on a sort key matches chronological order.
`<yyyy-mm>` is a `2026-06`-style month bucket.

## Item key schema

| Entity                  | pk                  | sk                         | gsi1pk                       | gsi1sk                              | gsi2pk   | gsi2sk                                  |
| ----------------------- | ------------------- | -------------------------- | ---------------------------- | ----------------------------------- | -------- | --------------------------------------- |
| Animal metadata         | `ANIMAL#<id>`       | `METADATA`                 | `SPECIES#<species>`          | `STATUS#<status>#<id>`              | `ANIMAL` | `STATUS#<status>#<createdAt>#<id>`      |
| Animal -> pasture pointer | `ANIMAL#<id>`     | `PASTURE`                  | `PASTURE#<pastureId>`        | `ANIMAL#<id>`                       | —        | —                                       |
| Move event              | `ANIMAL#<id>`       | `MOVE#<ts>`                | —                            | —                                   | —        | —                                       |
| Lifecycle event         | `ANIMAL#<id>`       | `EVENT#<ts>`               | `EVENT#<TYPE>#<yyyy-mm>`     | `<ts>`                              | —        | —                                       |
| Pasture                 | `PASTURE#<id>`      | `METADATA`                 | `PASTURE`                    | `<name>`                            | —        | —                                       |
| Feed purchase           | `FEED#<yyyy-mm>`    | `PURCHASE#<ts>#<id>`       | `FEED#<type>`               | `<ts>`                              | —        | —                                       |

## Access pattern -> index map

| # | Access pattern                                       | Operation | Index | Key condition                                                            |
| - | ---------------------------------------------------- | --------- | ----- | ------------------------------------------------------------------------ |
| 1 | Get one animal's metadata                            | GetItem   | table | `pk = ANIMAL#<id>`, `sk = METADATA`                                       |
| 2 | List all events/moves/pointers for an animal         | Query     | table | `pk = ANIMAL#<id>` (optionally `begins_with(sk, "MOVE#"/"EVENT#")`)        |
| 3 | List animals of a species (by status)                | Query     | GSI1  | `gsi1pk = SPECIES#<species>` (optionally `begins_with(gsi1sk, "STATUS#<status>")`) |
| 4 | List all animals by status, newest first             | Query     | GSI2  | `gsi2pk = ANIMAL`, `begins_with(gsi2sk, "STATUS#<status>")`, `ScanIndexForward=false` |
| 5 | List animals currently in a pasture                  | Query     | GSI1  | `gsi1pk = PASTURE#<pastureId>`, `begins_with(gsi1sk, "ANIMAL#")`           |
| 6 | List an animal's move history (chronological)        | Query     | table | `pk = ANIMAL#<id>`, `begins_with(sk, "MOVE#")`                             |
| 7 | List an animal's lifecycle events (chronological)    | Query     | table | `pk = ANIMAL#<id>`, `begins_with(sk, "EVENT#")`                            |
| 8 | List lifecycle events of a type in a month           | Query     | GSI1  | `gsi1pk = EVENT#<TYPE>#<yyyy-mm>` (range on `gsi1sk = <ts>`)               |
| 9 | Get one pasture                                      | GetItem   | table | `pk = PASTURE#<id>`, `sk = METADATA`                                      |
| 10| List all pastures, alphabetical by name              | Query     | GSI1  | `gsi1pk = PASTURE` (sorted by `gsi1sk = <name>`)                           |
| 11| List feed purchases for a month                      | Query     | table | `pk = FEED#<yyyy-mm>`, `begins_with(sk, "PURCHASE#")`                      |
| 12| List feed purchases of a type (chronological)        | Query     | GSI1  | `gsi1pk = FEED#<type>` (range on `gsi1sk = <ts>`)                          |

## Notes

- The **animal -> pasture pointer** is a separate item (`sk = PASTURE`) so
  the "who is in this pasture" lookup (pattern 5) is a single GSI1 Query.
  Moving an animal rewrites this item's `gsi1pk` and appends a
  `MOVE#<ts>` history item under the animal's partition.
- Lifecycle events are double-keyed: the base table partition (pattern 7)
  gives per-animal history; GSI1 (pattern 8) gives the cross-animal
  "all <TYPE> events this month" report without a Scan.
- Feed purchases partition by month (`FEED#<yyyy-mm>`) to keep partitions
  bounded; GSI1 (`FEED#<type>`) supports the by-type rollup.
- `expiresAt` is reserved for TTL on any ephemeral records (e.g.
  idempotency entries); permanent records omit it.
