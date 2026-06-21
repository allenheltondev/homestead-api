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
| Feed purchase -> id pointer | `FEEDID#<id>`   | `POINTER`                  | —                            | —                                   | —        | —                                       |
| Feed consumption        | `FEEDUSE#<yyyy-mm>` | `USE#<ts>#<id>`            | —                            | —                                   | —        | —                                       |
| Feed consumption -> id pointer | `FEEDUSEID#<id>` | `POINTER`              | —                            | —                                   | —        | —                                       |
| Egg collection          | `EGG#<yyyy-mm>`     | `COLLECT#<ts>#<id>`        | —                            | —                                   | —        | —                                       |
| Egg collection -> id pointer | `EGGID#<id>`   | `POINTER`                  | —                            | —                                   | —        | —                                       |

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
| 13| Resolve a feed purchase's key from its id (for DELETE) | GetItem | table | `pk = FEEDID#<id>`, `sk = POINTER`                                         |
| 14| List egg collections for a month                     | Query     | table | `pk = EGG#<yyyy-mm>`, `begins_with(sk, "COLLECT#")` (or `sk BETWEEN` for a ts range) |
| 15| Resolve an egg collection's key from its id (for DELETE) | GetItem | table | `pk = EGGID#<id>`, `sk = POINTER`                                          |
| 16| List feed consumption for a month                    | Query     | table | `pk = FEEDUSE#<yyyy-mm>`, `begins_with(sk, "USE#")` (or `sk BETWEEN` for a ts range; optional `feedType` `FilterExpression`) |
| 17| Resolve a feed consumption's key from its id (for DELETE) | GetItem | table | `pk = FEEDUSEID#<id>`, `sk = POINTER`                                  |

## Notes

- The **animal -> pasture pointer** is a separate item (`sk = PASTURE`) so
  the "who is in this pasture" lookup (pattern 5) is a single GSI1 Query.
  Moving an animal rewrites this item's `gsi1pk` and appends a
  `MOVE#<ts>` history item under the animal's partition.
- Lifecycle events are double-keyed: the base table partition (pattern 7)
  gives per-animal history; GSI1 (pattern 8) gives the cross-animal
  "all <TYPE> events this month" report without a Scan.
- Feed purchases partition by month (`FEED#<yyyy-mm>`) to keep partitions
  bounded; GSI1 (`FEED#<type>`) supports the by-type rollup. A separate
  id-pointer item (`pk = FEEDID#<id>`, `sk = POINTER`, holding `targetPk` /
  `targetSk`) lets `DELETE /feed-purchases/{id}` resolve the base-table key
  from the bare id with a `GetItem` instead of a Scan.
- **Feed purchase fields** come in two backward-compatible shapes:
  - *bag shape* (`POST` with `bags`): stores `bags` (int >= 1),
    `bagWeightLbs` (number > 0), `totalLbs = bags * bagWeightLbs`,
    `feedType`, optional `cost` (default 0), and `purchasedAt`.
  - *legacy shape*: stores `quantity`, `unit`, `cost`, `vendor`,
    `purchasedAt`.
  `feedType`/`type` is normalized to lower case, and the aliases
  `chicken` / `layer` / `poultry` collapse to a single `poultry` type so
  the cost-per-dozen analytics can sum poultry feed spend.
- **Egg collections** partition by month (`EGG#<yyyy-mm>`); the sort key
  `COLLECT#<ts>#<id>` (ts = `collectedAt` ISO) keeps a month's collections
  chronological. Fields: `count` (int >= 1), `collectedAt` (ISO), optional
  `coop`, `createdAt`. A range list fans out one `Query` per month
  partition in the window (no Scan). Like feed purchases, an id-pointer item
  (`pk = EGGID#<id>`, `sk = POINTER`) backs scan-free DELETE by bare id.
- **Feed consumption** partitions by month (`FEEDUSE#<yyyy-mm>`); the sort
  key `USE#<ts>#<id>` (ts = `usedAt` ISO) keeps a month's usage chronological.
  Fields: `feedType` (normalized lower-case; chicken/layer/poultry collapse to
  `poultry`), `lbs` (number > 0), `usedAt` (ISO), `createdAt`. `POST
  /feed-consumption` accepts `{ feedType, lbs }` or `{ feedType, bags,
  bagWeightLbs }` (lbs = bags \* bagWeightLbs). A range list fans out one
  `Query` per month partition (pattern 16), filtering an optional `type`
  in-partition (no Scan). Like feed purchases and egg collections, an
  id-pointer item (`pk = FEEDUSEID#<id>`, `sk = POINTER`) backs scan-free
  DELETE by bare id (pattern 17). Create publishes a `FeedConsumed` event.
- **Feed inventory** (`GET /stats/feed-inventory`) composes feed purchases
  (lbs in) with feed consumption (lbs out) into a per-`feedType` position:
  `purchasedLbs` (prefer `totalLbs`, else `bags * bagWeightLbs`, else the
  legacy `quantity` treated as lb), `consumedLbs`, `onHandLbs`
  (`purchasedLbs - consumedLbs`, floored at 0), `avgUnitCost`
  (`purchaseCost / purchasedLbs`, $/lb), `onHandValue`
  (`onHandLbs * avgUnitCost`), `burnRateLbsPerDay` (consumed lbs over a
  trailing 30-day window ÷ 30), `daysRemaining` (`onHandLbs / burnRate`, null
  when burnRate is 0), and `projectedRunOutDate` (today + daysRemaining), plus
  a `totals` object. It `Query`s only the `FEED#<yyyy-mm>` (pattern 11) and
  `FEEDUSE#<yyyy-mm>` (pattern 16) partitions -- no Scans. The
  `/stats/summary` `feed` block composes `onHandLbs` + `daysRemaining` from
  these totals.
- **Egg analytics** (`GET /stats/eggs`, `/stats/egg-cost`, and the egg
  blocks of `/stats/summary`) are read-only aggregations: they `Query` the
  egg month partitions (pattern 14) and the feed month partitions
  (pattern 11) for the period and tally in memory. `costPerDozen` divides
  poultry feed spend by dozens (null when there are no dozens); the store
  comparison uses `STORE_EGG_PRICE_PER_DOZEN` (or a `storePricePerDozen`
  query-param override). No Scans.
- **Refined cost-per-dozen** (`GET /stats/egg-cost`): the top-level
  `costPerDozen` is the original **purchase basis** (poultry feed *spend* over
  the period ÷ dozens) and is unchanged for backward compatibility. The added
  `consumptionBasis` block is the **consumption basis**: poultry feed
  *consumed* during the period (pattern 16), valued at the average purchase
  unit cost (`avgUnitCost`, $/lb), divided by the dozens collected in *lay
  months* only -- months in the period that actually have egg collections.
  This matches feed eaten to eggs produced, so it doesn't swing with purchase
  timing and ignores out-of-lay months with feed usage but no eggs. Cost
  figures are null when `avgUnitCost` is null (no poultry weight purchased) or
  there are no lay-month dozens. No Scans.
- `expiresAt` is reserved for TTL on any ephemeral records (e.g.
  idempotency entries); permanent records omit it.
