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
| Health expense          | `HEALTHEXP#<yyyy-mm>` | `EXP#<ts>#<id>`         | —                            | —                                   | —        | —                                       |
| Health expense -> id pointer | `HEALTHEXPID#<id>` | `POINTER`             | —                            | —                                   | —        | —                                       |
| Milk log                | `MILK#<yyyy-mm>`    | `LOG#<ts>#<id>`            | —                            | —                                   | —        | —                                       |
| Milk log -> id pointer  | `MILKID#<id>`       | `POINTER`                  | —                            | —                                   | —        | —                                       |
| Incubation batch        | `INCUBATION#<id>`   | `METADATA`                 | `INCUBATION`                 | `<setAt>`                           | —        | —                                       |
| Breeding record         | `BREEDING#<id>`     | `METADATA`                 | `BREEDING`                   | `<expectedDueAt>`                   | —        | —                                       |
| Grow-out batch          | `GROWOUT#<id>`      | `METADATA`                 | `GROWOUT`                    | `<startedAt>`                       | —        | —                                       |
| Care task               | `CARETASK#<id>`     | `METADATA`                 | `CARETASK`                   | `<nextDueAt>`                       | —        | —                                       |
| Sale                    | `SALE#<yyyy-mm>`    | `SALE#<ts>#<id>`           | —                            | —                                   | —        | —                                       |
| Sale -> id pointer      | `SALEID#<id>`       | `POINTER`                  | —                            | —                                   | —        | —                                       |

Egg collections also carry an optional `birdType` (one of
chicken/duck/goose/turkey, default chicken) stored on the row; the keys are
unchanged.

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
| 18| List health expenses for a month                     | Query     | table | `pk = HEALTHEXP#<yyyy-mm>`, `begins_with(sk, "EXP#")` (or `sk BETWEEN` for a ts range; optional `category` `FilterExpression`) |
| 19| Resolve a health expense's key from its id (for DELETE) | GetItem | table | `pk = HEALTHEXPID#<id>`, `sk = POINTER`                                |
| 20| Deaths by cause in a month (mortality)               | Query     | GSI1  | `gsi1pk = EVENT#DEATH#<yyyy-mm>` (items pulled to read `cause`)            |
| 21| List milk logs for a month                           | Query     | table | `pk = MILK#<yyyy-mm>`, `begins_with(sk, "LOG#")` (or `sk BETWEEN` for a ts range) |
| 22| Resolve a milk log's key from its id (for DELETE)    | GetItem   | table | `pk = MILKID#<id>`, `sk = POINTER`                                         |
| 23| List all incubation batches                          | Query     | GSI1  | `gsi1pk = INCUBATION` (ordered by `gsi1sk = <setAt>`)                      |
| 24| List all breedings / breedings due within N days     | Query     | GSI1  | `gsi1pk = BREEDING` (range on `gsi1sk = <expectedDueAt>` for the due window) |
| 25| List all grow-out batches                            | Query     | GSI1  | `gsi1pk = GROWOUT` (ordered by `gsi1sk = <startedAt>`)                     |
| 26| List care tasks (ordered) / due within N days        | Query     | GSI1  | `gsi1pk = CARETASK` (range on `gsi1sk = <nextDueAt>`, `<=` upper bound for the due window) |
| 27| List sales for a month                               | Query     | table | `pk = SALE#<yyyy-mm>`, `begins_with(sk, "SALE#")` (or `sk BETWEEN` for a ts range) |
| 28| Resolve a sale's key from its id (for DELETE)        | GetItem   | table | `pk = SALEID#<id>`, `sk = POINTER`                                         |

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
- **Health expenses** partition by month (`HEALTHEXP#<yyyy-mm>`); the sort
  key `EXP#<ts>#<id>` (ts = `incurredAt` ISO) keeps a month's expenses
  chronological. Fields: `category` (normalized lower-case), `cost`
  (number >= 0), optional `animalRef`, optional `note`, `incurredAt` (ISO),
  `createdAt`. `POST /health-expenses` accepts
  `{ category, cost, animalRef?, note?, incurredAt? }`. A range list fans out
  one `Query` per month partition (pattern 18), filtering an optional
  `category` in-partition (no Scan). Like the other month-bucketed entities, an
  id-pointer item (`pk = HEALTHEXPID#<id>`, `sk = POINTER`) backs scan-free
  DELETE by bare id (pattern 19). Create publishes a `HealthExpenseRecorded`
  event.
- **Mortality / health analytics**
  (`GET /stats/mortality`, `/stats/health`) are read-only aggregations.
  `/stats/mortality` pulls the `EVENT#DEATH#<yyyy-mm>` items (pattern 20) for
  the period and tallies `byCause` from each death event's `cause` attribute
  (recorded by `POST /animals/{id}/death`); `lossRate` approximates deaths over
  the average active herd size, using `activeCount + deaths` as the denominator
  (no historical herd snapshots are kept). `/stats/health` sums
  `HEALTHEXP#<yyyy-mm>` rows (pattern 18) into `totalSpend`, `byCategory`, and a
  `perAnimal` figure (total spend ÷ current active animals). No Scans.
- **Per-flock egg attribution.** Feed purchases and feed consumption accept an
  optional `flock` string (the coop id) that is stored when provided; legacy
  rows are unaffected and untagged. Eggs already carry `coop`, which is treated
  as the flock key. `GET /stats/egg-cost` accepts an optional `flock` query that
  restricts eggs to `coop == flock` and poultry feed to `flock == flock`; with
  no `flock` the behavior (and payload shape) is unchanged.
  `GET /stats/egg-cost/by-flock` returns one cost-per-dozen row per flock seen
  in the period's egg collections (`{ flock, dozens, poultryFeedSpend,
  costPerDozen, consumptionBasis }`). No Scans (egg + feed month partitions
  only).
- **Weekly digest** (`GET /stats/digest`, and the scheduled `DigestFunction`)
  composes the existing stats aggregations over the trailing 7 days into a
  `{ period, eggs, feedSpend, feedOnHandLbs, daysRemaining, births, deaths,
  mortality, lines }` payload. The scheduled function always publishes a
  `HomesteadDigest` event and, when `DIGEST_SENDER` + `DIGEST_RECIPIENT` are
  configured, emails it via SES (failures never fail the schedule). No Scans.
- **Milk logs** partition by month (`MILK#<yyyy-mm>`); the sort key
  `LOG#<ts>#<id>` (ts = `loggedAt` ISO) keeps a month's logs chronological.
  Fields: optional `animalId`, `volume` (> 0), `unit` (default `gallon`;
  gallon/quart/liter/ml), `loggedAt` (ISO), `createdAt`. `POST /milk-logs`
  accepts `{ animalId?, volume, unit?, date? }`; a range list (pattern 21) fans
  out one `Query` per month partition; an id-pointer item (pattern 22) backs
  scan-free DELETE. Create publishes a `MilkLogged` event. `GET /stats/milk`
  sums volume normalized to gallons (per-animal + per-day breakdowns);
  `GET /stats/milk-cost` divides goat-type feed spend by gallons -> cost per
  gallon vs. a market price (mirrors egg-cost). No Scans.
- **Eggs by bird type.** Egg collections accept an optional `birdType`
  (chicken/duck/goose/turkey, default chicken) stored on the row; legacy rows
  read as chicken. `GET /stats/eggs` and `/stats/egg-cost` accept an optional
  `birdType` query that restricts the totals, and `/stats/eggs` always returns a
  `byBirdType` breakdown. With no `birdType` the original top-level figures are
  unchanged. No Scans.
- **Incubation batches** are single metadata items
  (`pk = INCUBATION#<id>`, `sk = METADATA`) listed via a collection-partition
  GSI (`gsi1pk = INCUBATION`, `gsi1sk = <setAt>`, pattern 23). `expectedHatchAt`
  is computed from species incubation days (chicken 21, turkey 28, goose 30,
  duck 28, default 21). `POST/GET /incubation-batches`,
  `PATCH /incubation-batches/{id}` (records `hatchedCount` + `status`), and
  `DELETE`. Create publishes `EggsSet`; the hatch PATCH publishes `Hatched`.
  `GET /stats/incubation` reports active batches + overall hatch rate. No Scans.
- **Breeding records** are single metadata items
  (`pk = BREEDING#<id>`, `sk = METADATA`) listed via a collection-partition GSI
  keyed by `expectedDueAt` (`gsi1pk = BREEDING`, pattern 24). `expectedDueAt` is
  computed from gestation days (goat 150, sheep 147, pig 114, default 150).
  `POST/GET/DELETE /breedings`. `GET /stats/breeding/upcoming?withinDays=`
  range-queries the GSI for breedings due within N days. No Scans.
- **Grow-out batches** are single metadata items
  (`pk = GROWOUT#<id>`, `sk = METADATA`) listed via a collection-partition GSI
  keyed by `startedAt` (`gsi1pk = GROWOUT`, pattern 25). `POST/GET /growout`,
  `PATCH /growout/{id}/process` (records `processedAt`, `dressedWeightLbsTotal`,
  `processedCount`, flips status to `processed`), and `DELETE`.
  `GET /stats/growout` reports active + processed dressed yield lbs and an
  optional feed cost-to-raise when a `period` is supplied. No Scans.
- **Care tasks** are single metadata items
  (`pk = CARETASK#<id>`, `sk = METADATA`) listed via a collection-partition GSI
  ordered by `nextDueAt` (`gsi1pk = CARETASK`, pattern 26). Fields: `title`,
  `category`, optional `target`, `cadenceDays`, `lastDoneAt?`, `nextDueAt`.
  `POST/GET/PATCH/DELETE /care-tasks`; `POST /care-tasks/{id}/complete` sets
  `lastDoneAt = now` and advances `nextDueAt = now + cadenceDays` (rewriting
  `gsi1sk` so the order stays consistent). `GET /stats/care/due?withinDays=`
  (default 7) range-queries the GSI with a `<=` upper bound (includes overdue).
  No Scans.
- **Sales** partition by month (`SALE#<yyyy-mm>`); the sort key
  `SALE#<ts>#<id>` (ts = `soldAt` ISO) keeps a month's sales chronological.
  Fields: `item`, `amount` (>= 0), optional `quantity`, `soldAt`, `createdAt`.
  `POST/GET(?from=&to=)/DELETE /sales` (range fan-out pattern 27; id-pointer
  DELETE pattern 28). Create publishes a `SaleRecorded` event. No Scans.
- **Homestead P&L** (`GET /stats/pnl`) composes costs (feed spend + health
  spend, reusing the existing aggregations) and outputs (`eggsValue` = dozens ×
  store egg price, `milkValue` = gallons × milk price, `meatValue` = grow-out
  dressed lbs × meat price, `salesRevenue` = sum of actual sales) into a
  `net = outputs − costs`. Prices resolve from query params, else the
  `STORE_EGG_PRICE_PER_DOZEN` / `MILK_PRICE_PER_GALLON` / `MEAT_PRICE_PER_LB`
  env vars, else defaults. No Scans (egg/milk/sale month partitions + the
  grow-out collection partition only).
- **Daily alerts** (the scheduled `AlertsFunction`) compose low-feed warnings
  (feed-inventory `daysRemaining` < `LOW_FEED_ALERT_DAYS`), care tasks due
  within 3 days, upcoming hatches + breedings (within 7 days), and — when
  `HOMESTEAD_LATITUDE` / `HOMESTEAD_LONGITUDE` are set — a daily open-meteo
  forecast yielding frost (< 2 °C) / heat (> 32 °C) flags. The function ALWAYS
  publishes a `HomesteadAlert` event and, when `DIGEST_SENDER` +
  `DIGEST_RECIPIENT` are configured, emails the alerts via SES (best effort —
  a delivery failure never fails the run). The optional weather fetch needs
  internet egress; the function runs on default Lambda networking (no VPC) so
  it has outbound access. No Scans.
- `expiresAt` is reserved for TTL on any ephemeral records (e.g.
  idempotency entries); permanent records omit it.
