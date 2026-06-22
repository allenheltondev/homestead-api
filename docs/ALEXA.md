# Alexa Skill

A personal Alexa skill that account-links to the same Cognito user pool as
the dashboard and calls the Homestead REST API on the user's behalf. The
skill backend is an `AWS::Serverless::Function` (`AlexaSkillFunction`,
`CodeUri: alexa`) built with [`ask-sdk-core`][asksdk] and invoked via an
`AlexaSkill` event.

## Layout

```
alexa/
  index.mjs              Lambda entry: SkillBuilders.custom() + handlers
  handlers/intents.mjs   ask-sdk RequestHandlers (one per intent) + error handler
  lib/api.mjs            HTTP client -> Homestead API (forwards the linked token)
  lib/speech.mjs         Pure payload -> spoken-English renderers
  lib/slots.mjs          Pure intent-slot -> API request-body builders
  tests/                 Jest unit tests (mock fetch / the API client)
```

## Intents

| Intent                   | API call                | Spoken result                                   |
| ------------------------ | ----------------------- | ----------------------------------------------- |
| `GetHerdSummaryIntent`   | `GET /stats/summary`    | Herd by species, births/deaths + feed spend MTD |
| `GetHerdCountIntent`     | `GET /stats/herd`       | Total + active animals, counts by species       |
| `GetEggStatsIntent`      | `GET /stats/eggs`       | Eggs collected, dozens, per-day (+ APL screen)  |
| `GetEggCostIntent`       | `GET /stats/egg-cost`   | Cost per dozen vs store price (+ APL screen)    |
| `LogFeedPurchaseIntent`  | `POST /feed-purchases`  | Confirms bags × weight = total                  |
| `LogEggCollectionIntent` | `POST /egg-collections` | Confirms the logged egg count                   |
| `RecordBirthIntent`      | `POST /births`          | Confirms the recorded birth                     |
| `RecordDeathIntent`      | `POST /deaths`          | Confirms the recorded death                     |
| `MoveAnimalsIntent`      | `POST /moves`           | Confirms the move                               |

Plus the standard `LaunchRequest`, `AMAZON.HelpIntent`,
`AMAZON.Cancel/StopIntent`, `AMAZON.FallbackIntent`,
`AMAZON.NavigateHomeIntent`, and `SessionEndedRequest` handlers, and a
catch-all error handler.

The write intents are **dialog-managed**: Alexa elicits and confirms the
required slots before the handler runs (see "Interaction model & dialog
auto-delegation" below). Missing required slots are collected by Alexa rather
than the handler re-prompting.

## How the skill authenticates to the API

Every API-backed intent reads the account-linking token from the request:

```
handlerInput.requestEnvelope.context.System.user.accessToken
```

and forwards it as `Authorization: Bearer <token>` to `process.env.API_BASE_URL`
(`lib/api.mjs`). If the token is absent the skill speaks a "please link your
account" prompt with a `LinkAccount` card; a `401`/`403` from the API is
treated the same way.

## Account linking (Cognito OAuth2)

Account linking uses the **OAuth2 authorization-code grant** against the
**Cognito Hosted UI** for the *same* user pool the dashboard uses
(`/readysetcloud/auth/user-pool-arn`). Create a **dedicated Alexa app
client** in that pool rather than reusing the dashboard client.

### 1. Cognito Hosted UI domain

Ensure the user pool has a Hosted UI domain, e.g.
`https://<your-domain>.auth.<region>.amazoncognito.com`.

### 2. Dedicated Alexa app client

In the user pool, create an app client for Alexa with:

- **Authorization code grant** enabled (OAuth flow `code`).
- A **client secret** (Alexa account linking uses a confidential client).
- Allowed callback URLs set to the **Alexa redirect URLs** shown on the
  skill's Account Linking page. There are three (one per Amazon region):
  - `https://alexa.amazon.co.jp/api/skill/link/<vendorId>`
  - `https://layla.amazon.com/api/skill/link/<vendorId>`
  - `https://pitangui.amazon.com/api/skill/link/<vendorId>`
- **Scopes:** `openid` plus the resource-server scopes the API needs (a
  minimal `openid profile` is sufficient for this skill, which only needs an
  authenticated identity). `aws.cognito.signin.user.admin` is **not** needed.

### 3. Skill Account Linking config (Alexa developer console)

| Field                          | Value                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| Auth grant type                | Authorization Code Grant                                              |
| Authorization URI              | `https://<domain>.auth.<region>.amazoncognito.com/oauth2/authorize`   |
| Access Token URI               | `https://<domain>.auth.<region>.amazoncognito.com/oauth2/token`       |
| Client ID                      | the Alexa app client id                                               |
| Client Secret                  | the Alexa app client secret                                           |
| Client Authentication Scheme   | HTTP Basic                                                            |
| Scopes                         | `openid`, `profile` (add resource-server scopes if introduced)        |

Alexa stores the access (and refresh) token from the `/oauth2/token`
exchange and presents the access token to the skill on every request as
`context.System.user.accessToken`.

## Token type: the `aud` problem (IMPORTANT)

The API's Lambda authorizer (`api/authorizer.mjs`) verifies a Cognito **id
token** — it is configured with `tokenUse: "id"` and validates that the
token's `aud` claim equals `UserPoolClientId`. Cognito's `/oauth2/token`
endpoint, however, returns an **access token** for API authorization (whose
`aud` claim is absent; it carries `client_id` and `scope` instead). So the
account-linked token Alexa forwards will **not** pass the current authorizer
as-is.

Pick one of the following; this stream documents the options but does **not**
modify `api/authorizer.mjs`:

1. **Forward the id token (no API change).** Configure the Alexa app client
   with `openid` scope and use the **id token** from the `/oauth2/token`
   response as the linked token. The id token's `aud` is the app client id.
   Because the *Alexa* app client id differs from the dashboard's
   `UserPoolClientId`, the authorizer must accept **both** client ids — pass
   an array of client ids to `CognitoJwtVerifier.create({ clientId: [...] })`
   (a one-line authorizer change, tracked separately, outside this stream's
   file ownership). Note: Alexa surfaces the linked token to the skill as
   `accessToken` regardless of whether it is technically an id or access
   token, so `lib/api.mjs` needs no change.

2. **Verify access tokens in the authorizer.** Add a second
   `CognitoJwtVerifier` with `tokenUse: "access"` and validate `client_id`
   (access tokens have no `aud`) against the allowed Alexa app client id,
   plus any required `scope`. The authorizer tries id-token verification
   first and falls back to access-token verification. Again an authorizer
   change, called out here but not made in this stream.

Either way the required follow-up is a small, additive change in
`api/authorizer.mjs`. Until it lands, the skill links successfully and the
voice flow works end-to-end *except* that API calls return `401`, which the
skill surfaces as the account-linking prompt.

## Deployment

The skill ships as part of the same SAM stack:

- `AlexaSkillFunction` (`CodeUri: alexa`, `Handler: index.handler`) with
  `API_BASE_URL` pointing at this stack's API.
- The `AlexaSkill` event makes Alexa the only invoker. Set the
  **`AlexaSkillId`** stack parameter (after creating the skill) to restrict
  the trigger to that single skill id.
- Configure the skill's default endpoint in the Alexa developer console to
  the **`AlexaSkillFunctionArn`** stack output.

[asksdk]: https://github.com/alexa/alexa-skills-kit-sdk-for-nodejs

## Token type: id vs access (authorizer)

The API Lambda authorizer (`api/authorizer.mjs`) accepts **both** Cognito
**id** tokens (dashboard sign-in) and **access** tokens (Alexa account
linking), validated against the allowed app clients. Provide the Alexa
app client id at deploy time via the `AlexaUserPoolClientId` template
parameter (CI/deploy var `ALEXA_USER_POOL_CLIENT_ID`) so access tokens
minted for the Alexa client pass `client_id` validation. If the Alexa
skill reuses the dashboard app client, no extra config is needed.

## Interaction model & dialog auto-delegation

The versioned interaction model lives at
`alexa/skill-package/interactionModels/custom/en-US.json` (invocation name
**"homestead"**). Upload it to the skill via the ASK CLI / developer console;
it is not deployed by the SAM stack. It defines a `FeedType` custom slot type
(synonyms: chicken/layer/poultry → `chicken`, cow/cattle → `cattle`, goat,
sheep, pig, horse, plus hay/grain), the read intents, and the dialog-managed
write intents.

### Dialog-managed (multi-turn) write intents

The model's `dialog` block sets `delegationStrategy: ALWAYS` and marks each
write intent's required slots `elicitationRequired` with elicitation prompts,
plus intent-level `confirmationRequired` with a read-back prompt. Alexa drives
the back-and-forth; the skill just delegates until the dialog is done:

```js
if (handlerInput.requestEnvelope.request.dialogState !== "COMPLETED") {
  return handlerInput.responseBuilder.addDelegateDirective().getResponse();
}
// COMPLETED: build fields from filled slots and call the API.
```

| Intent                  | Required slots (elicited)        | Optional slots          | API call                |
| ----------------------- | -------------------------------- | ----------------------- | ----------------------- |
| `LogFeedPurchaseIntent` | `bags`, `bagWeight`, `feedType`  | `cost`, `date`          | `POST /feed-purchases`  |
| `LogEggCollectionIntent`| `count`                          | `date`, `coop`          | `POST /egg-collections` |
| `RecordBirthIntent`     | `species`, `count`               | `dam`, `sire`, `date`   | `POST /births`          |
| `RecordDeathIntent`     | `animalRef`                      | `cause`, `date`         | `POST /deaths`          |
| `MoveAnimalsIntent`     | `group`, `pasture`               | `date`                  | `POST /moves`           |

`LogFeedPurchaseIntent` confirms by reading back the computed total
("4 fifty-pound bags, 200 pounds of chicken feed — add it?"). The skill passes
`{bags, bagWeightLbs, feedType}` to the API verbatim — the server computes the
total weight (the slot builder computes nothing). Each write intent supports
both one-shot utterances ("I bought {bags} {bagWeight} pound bags of {feedType}
food {date}") and partial ones ("I bought food") that kick off elicitation.

Spoken quantities: prefer `AMAZON.NUMBER`, but the slot builders map a literal
"a dozen" → 12 (and "half dozen" → 6, "two dozen" → 24) when the word comes
through as text.

### Read intents + APL egg screens

`GetEggStatsIntent` and `GetEggCostIntent` take an optional free-text `period`
slot. They speak a rendered summary (`renderEggStats`, `renderEggCost` — the
cost line includes a break-even comparison to the store price) and, on
APL-capable devices only, render a visual screen. `lib/apl.mjs` gates every
`add*Screen` on `Alexa.Presentation.APL` in the device's supported interfaces
(same pattern as the rest of the skill), so headless devices (Echo Dot, phone)
stay voice-only. The `eggStatsDocument` / `eggCostDocument` templates
(`apl/documents.mjs`) use the dark "homestead green" palette; the cost screen
shows a cheaper / pricier badge.

## Echo Show visuals (APL)

On screen devices (Echo Show, Fire TV) the skill renders **APL** documents
alongside the spoken response; on headless Echo devices it stays voice-only.
The render path is gated on `Alexa.Presentation.APL` device support
(`alexa/lib/apl.mjs`), so nothing changes for audio-only devices.

Screens (`alexa/apl/documents.mjs`):
- **Home** (LaunchRequest) — title + spoken-command hints.
- **Herd summary** (GetHerdSummaryIntent) — total, per-species counts, and a
  births / deaths / feed-spend footer.
- **Herd count** (GetHerdCountIntent) — total, per-species counts, active +
  species footer (reuses the herd layout).
- **Confirmation** (RecordBirth / RecordFeedPurchase) — checkmark + message.

### Enable APL in the skill manifest
APL only renders if the skill declares the interface. In the skill package
manifest (`skill.json`):

```json
{
  "manifest": {
    "apis": {
      "custom": {
        "interfaces": [{ "type": "ALEXA_PRESENTATION_APL" }]
      }
    }
  }
}
```

Preview/iterate on the documents in the **APL authoring tool**
(developer.amazon.com → Alexa → APL) by pasting a document from
`alexa/apl/documents.mjs` with a sample datasource.

## Feed usage logging & inventory

Two intents extend the feed workflow beyond purchases:

- **LogFeedUsageIntent** (`LogFeedUsageIntentHandler`) — a dialog-managed write
  intent (same `addDelegateDirective()` pattern as the other writes). Required
  slots are `feedType` (the `FeedType` custom slot) and `amount`
  (`AMAZON.NUMBER`); `unit` and `date` are optional. `buildFeedUsageFields`
  (`alexa/lib/slots.mjs`) normalizes the spoken amount + unit into pounds
  (defaulting to pounds, converting kg/ton) before `POST /feed-consumption`.
  One-shot: "I fed 25 pounds of chicken food today"; partial: "I fed the
  chickens" (Alexa elicits the missing slots, then confirms).
- **GetFeedInventoryIntent** (`GetFeedInventoryIntentHandler`) — read-only,
  optional `feedType` filter. Calls `GET /stats/feed-inventory` and speaks
  on-hand pounds, days remaining, and the projected run-out date
  (`renderFeedInventory`). On APL devices it renders the **Feed inventory**
  screen (`feedInventoryDocument`): one labeled on-hand bar per feed type plus a
  days-remaining readout (`addFeedInventoryScreen` /
  `buildFeedInventoryDatasource`, gated on `Alexa.Presentation.APL`).

## Health, mortality & weekly digest

Three insight features extend the read/write surface:

- **RecordHealthExpenseIntent** (`RecordHealthExpenseIntentHandler`) — a
  dialog-managed write intent (same `addDelegateDirective()` pattern as the
  other writes). Required slots are `category` (the `HealthCategory` custom
  slot: vet / medicine / supplies / testing) and `cost` (`AMAZON.NUMBER`);
  `animalRef` and `date` are optional. `buildHealthExpenseFields`
  (`alexa/lib/slots.mjs`) maps them to the `POST /health-expenses` body.
  One-shot: "I spent 60 dollars at the vet today"; partial: "I had a vet bill"
  (Alexa elicits the missing slots, then confirms). The confirmation is spoken
  by `renderHealthExpenseLogged` and, on APL devices, shown on the shared
  confirmation screen.
- **GetHealthStatsIntent** (`GetHealthStatsIntentHandler`) — read-only, optional
  `period`. Calls `GET /stats/health` and speaks the total health spend with an
  optional by-category breakdown (`renderHealthStats`). "How much have I spent
  on vet bills this month".
- **GetMortalityIntent** (`GetMortalityIntentHandler`) — read-only, optional
  `period`. Calls `GET /stats/mortality` and speaks how many animals were lost
  plus the loss rate as a percentage (`renderMortality`, which accepts either a
  fractional `lossRate` like `0.04` or an already-percentage value). "What's my
  loss rate this year", "how many animals died".
- **GetWeeklyDigestIntent** (`GetWeeklyDigestIntentHandler`) — read-only. Calls
  `GET /stats/digest` and speaks the API-supplied `lines` array as one
  paragraph (`renderDigest`). "Give me my homestead digest", "what's my weekly
  summary".

### Per-flock egg cost

`GetEggCostIntent` gains an optional `flock` slot ("cost per dozen for the
{flock} coop"). `buildEggCostQuery` (`alexa/lib/slots.mjs`) combines the
existing optional `period` with the new optional `flock`, and `api.getEggCost`
forwards `flock` as a query-string filter on `GET /stats/egg-cost`. All prior
egg-cost utterances keep working unchanged.

## AI-agent fallback (Amazon Nova Pro on Bedrock)

When a phrase doesn't match any structured intent, the skill no longer says "I
didn't catch that." Instead it hands the utterance to an **Amazon Nova Pro**
model on **Amazon Bedrock** (via the **Converse API**), which has the homestead
API operations available as tools and can act on free-form requests.

### Catch-all SearchQuery intent

`CatchAllIntent` (`alexa/skill-package/interactionModels/custom/en-US.json`) has
a single `query` slot of type `AMAZON.SearchQuery` with a `"{query}"` sample, so
any phrase the structured intents don't claim lands here. `CatchAllIntentHandler`
reads the `query` slot and calls `runAgent`. `AMAZON.FallbackIntent` also routes
into `runAgent` (using the raw input when the client provides it, else a generic
help prompt). The structured intents remain the primary path — the agent is only
the fallback. A SearchQuery catch-all is acceptable here because this is a
personal skill.

### The Converse tool loop (`alexa/lib/agent.mjs`)

`runAgent({ handlerInput, utterance })`:

1. Builds a `BedrockRuntimeClient` (region defaults to the Lambda's) and the
   tool list from `alexa/lib/tools.mjs`. The system prompt frames it as a
   homestead voice assistant that must keep answers short and speakable, must
   use tools rather than invent data, and must *propose* (not perform) changes.
2. Loops up to **3 iterations**, calling `ConverseCommand` with
   `{ modelId, system, messages, toolConfig: { tools }, inferenceConfig: {
   maxTokens: 512, temperature: 0 } }`.
3. On `stopReason === "tool_use"`, for each requested `{ toolUse }` block:
   - **READ** tools (`get_summary`, `get_herd`, `get_egg_stats`,
     `get_egg_cost`, `get_feed_inventory`, `get_health_stats`, `get_mortality`,
     `get_digest`) run inline against `lib/api.mjs`; the JSON result is appended
     as a `toolResult` user message and Converse is called again.
   - **WRITE** tools (`log_feed_purchase`, `log_feed_usage`,
     `log_egg_collection`, `record_birth`, `record_death`, `move_animals`,
     `record_health_expense`) are **not** executed in the loop. The first
     requested write is captured as a `pendingAction` and the loop breaks.
4. Otherwise (`end_turn`) the assistant's text is spoken; if the model produced
   nothing usable, a graceful "I couldn't find that" is spoken instead.

`runAgent` never throws to the user: Bedrock/API failures map to a spoken
apology, and `MissingToken`/401/403 map to the existing account-linking prompt.

### Write confirmation (confirm-gated)

When the agent proposes a write it stores the `pendingAction`
(`{ name, args, phrase }`) in Alexa **session attributes** and speaks
`"<phrase>. Should I do that?"` with a reprompt, keeping the session open.

- `AMAZON.YesIntent` → `ConfirmActionYesIntentHandler` reads `pendingAction`,
  executes the matching `lib/api.mjs` write via the tool registry, speaks a
  confirmation, and clears it.
- `AMAZON.NoIntent` → `ConfirmActionNoIntentHandler` discards the pending action
  and acknowledges.
- With nothing pending, both fall through to the help prompt.

The Yes/No handlers are registered **before** the catch-all in the `handlers`
array so a bare "yes"/"no" confirms the pending write rather than being swept
into the agent. The existing dialog-managed write intents (`LogFeedPurchase`,
`RecordBirth`, etc.) are unchanged and remain the primary write path.

### IAM, parameter, and model access

- `template.yaml` grants `AlexaSkillFunction` `bedrock:InvokeModel` and
  `bedrock:InvokeModelWithResponseStream`, scoped to the Nova Pro foundation
  model (`arn:${AWS::Partition}:bedrock:*::foundation-model/amazon.nova-pro-v1:0`)
  and the cross-region inference-profile ARN.
- A `BEDROCK_MODEL_ID` environment variable is set from the new `BedrockModelId`
  parameter (default `us.amazon.nova-pro-v1:0`, the US cross-region inference
  profile). Override it to pin a different region/profile or model.
- `@aws-sdk/client-bedrock-runtime` is added to `alexa/package.json`.

**Operator step — enable Nova Pro:** In the Amazon Bedrock console for the
deploy region, open **Model access** and request/enable access to **Amazon Nova
Pro** before the first deploy (model access is off by default). Confirm that the
region carries the inference profile the `BedrockModelId` resolves through
(e.g. `us.amazon.nova-pro-v1:0` requires a US region such as `us-east-1`); if
your Lambda runs elsewhere, set `BedrockModelId` to the matching `eu.*` /
`apac.*` profile (or a region-local model id) and enable access there.

## Garden harvests record to the Good Roots Network (per-crop)

Harvest logging and surplus sharing go through the Good Roots Network (GRN)
per-crop rather than a standalone harvest-log resource. The old
`/harvest-logs*` and `/harvest-logs/{id}/publish` endpoints are gone.

- **List crops:** `lib/api.mjs` `listGrnCrops()` → `GET /grn/crops`. Each crop
  carries an `id` (the `cropLibraryId`) and a `name`.
- **Record a harvest:** `recordHarvest({ cropLibraryId, amount, unit?, harvestedOn?, notes? })`
  → `POST /grn/crops/{cropLibraryId}/harvests`. The body only carries the
  harvest fields; the crop is in the path.
- **Publish surplus:** `publishSurplus(cropLibraryId, fields)` →
  `POST /grn/crops/{cropLibraryId}/publish-surplus`.
- **Stats unchanged:** `getGardenStats()` still hits `GET /stats/garden`.

Because the API is keyed by `cropLibraryId`, the skill resolves the spoken crop
NAME to an id before writing. `resolveCropLibraryId(api, cropName)` (exported
from `lib/api.mjs`) lists the grower's GRN crops and matches the name
case-insensitively (trimmed, exact). `LogHarvestIntentHandler`,
`ShareSurplusIntentHandler`, and the agent's `log_harvest` / `publish_surplus`
tool runners all resolve through it. When no crop matches, the skill speaks a
helpful nudge ("I couldn't find <crop> in your Good Roots crops — add it
first") instead of erroring, so growers know to add the crop in GRN first.
