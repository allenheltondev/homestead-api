# Farm Copilot (`POST /copilot`)

A **read-only** conversational endpoint that answers free-form questions across
all homestead data. It drives an Amazon Bedrock **Nova Pro** model through the
**Converse API's tool-use protocol** over the existing read-only domain/stats
aggregations — running them **in-process** against DynamoDB (no HTTP hop).

The copilot can only READ. There are no create/update/delete tools, so it can
never change, add, or remove homestead data.

## Request / response

`POST /copilot` — Cognito-authed via the API's default authorizer.

Request body:

```json
{
  "messages": [
    { "role": "user", "content": "Are my eggs cheaper than the store this month?" }
  ]
}
```

- `messages` is a non-empty array of `{ role: "user" | "assistant", content: string }`.
- A bad shape (missing array, bad role, empty content, non-JSON body) returns `400`.

Response (`200`):

```json
{
  "reply": "This month you produced 4 dozen eggs at $1.80/dozen — cheaper than the $4.00 store price, saving $2.20/dozen.",
  "toolsUsed": ["get_egg_cost"]
}
```

- `reply` — the final assistant text, grounded in the figures the tools returned.
- `toolsUsed` — the de-duplicated list of tool names the model invoked.

## The Converse tool-use loop

`api/copilot.mjs` builds a `ConverseCommand` with:

- `modelId` = `BEDROCK_MODEL_ID` env (defaults to the `us.amazon.nova-pro-v1:0`
  cross-region inference profile),
- a `system` prompt (concise, read-only copilot; today's date is injected;
  always ground answers in tool figures; never claim to mutate data),
- `toolConfig: { tools }` from the registry.

It loops: send → if `stopReason === "tool_use"`, run each requested tool
in-process, append a `toolResult` user turn, and resend. It stops on `end_turn`
or after at most ~6 iterations. Unknown tools and tool errors come back as error
`toolResult` blocks so the model can recover instead of failing the turn.

## Tools (all read-only)

`api/copilot/tools.mjs` exports `TOOL_SPECS` (Bedrock `toolSpec` shape) and
`REGISTRY` (name → async handler). Each handler calls a read-only
domain/stats function and returns JSON-serializable data:

| Tool                  | Backs onto                          | Use for |
| --------------------- | ----------------------------------- | ------- |
| `get_herd_summary`    | `herdStats`                         | Animal counts by species/status |
| `get_egg_stats`       | `eggStatsForPeriod`                 | Eggs/dozens collected for a period |
| `get_egg_cost`        | `eggCostStats`                      | Cost per dozen vs the store |
| `get_feed_inventory`  | `feedInventory`                     | On-hand feed, burn rate, run-out |
| `get_milk_stats`      | `milkStats`                         | Milk gallons for a period |
| `get_milk_cost`       | `milkCostStats`                     | Cost per gallon vs the market |
| `get_health_spend`    | `healthStats`                       | Health spend by category |
| `get_mortality`       | `mortalityStats`                    | Deaths + loss rate by cause |
| `get_pnl`             | `pnlStats`                          | Profit & loss (costs vs outputs) |
| `get_garden_stats`    | `gardenStats`                       | Harvest totals by crop (GRN) |
| `get_care_tasks_due`  | `listCareTasksDue`                  | Upcoming care tasks/chores |
| `get_grn_my_listings` | `listMyListings` (best-effort)      | The farm's own GRN listings |

A `period` input accepts a year (`YYYY`) or month (`YYYY-MM`) and defaults to the
current month. `get_grn_my_listings` is best-effort: it degrades to an empty list
when the Good Roots Network integration is not configured / unauthorized.

## Infrastructure

`CopilotFunction` (see `template.yaml`) is its own Lambda sharing `CodeUri: api`
with the `copilot.mjs` esbuild entry point. `Timeout: 29`, `MemorySize: 512`,
env `BEDROCK_MODEL_ID` + `TABLE_NAME`. Its policy grants DynamoDB **read** on the
table + indexes and `bedrock:InvokeModel` scoped to the Nova Pro foundation model
and inference-profile ARNs. The explicit `POST /copilot` route wins over the
`ApiFunction` proxy.

Nova Pro model access must be enabled in the Bedrock console for the deploy
region (same prerequisite as the Alexa skill — see `docs/ALEXA.md`).
