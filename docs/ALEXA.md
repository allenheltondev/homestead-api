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
