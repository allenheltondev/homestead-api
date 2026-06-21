# Architecture

Homestead is a serverless AWS SAM application that tracks homestead
animals, pastures, animal moves, lifecycle events, and feed purchases.

## Mono-lambda + Powertools Router

Every API route runs through a **single Lambda function** (`ApiFunction`,
`api/index.mjs`). Requests arrive at an `AWS::Serverless::Api` (REST API,
stage `v1`) whose `/{proxy+}` and `/` events both invoke that one
function. Inside the Lambda, a [Lambda Powertools `Router`][router]
dispatches on HTTP method + path.

```
API Gateway (REST, stage v1)
  -> Lambda authorizer (Cognito id-token verify)
  -> ApiFunction  (api/index.mjs -> createHttpRouterHandler)
       -> app.mjs (Router + notFound + errorHandler)
            -> routes/index.mjs  (registerRoutes -> register<Domain>Routes)
                 -> route handlers (thin) -> domain (data access) -> ddb
```

Why a mono-lambda:

- One warm container serves every path, so cold starts are amortized and
  there is a single deployment artifact.
- New feature streams plug in by adding **one import + one register line**
  to `api/routes/index.mjs`. No template change is needed to add a route.

### Layering

| Layer            | Location            | Responsibility                                            |
| ---------------- | ------------------- | --------------------------------------------------------- |
| Entry            | `api/index.mjs`     | Lambda handler, wraps the Router                          |
| App              | `api/app.mjs`       | Router instance, `notFound`, centralized `errorHandler`   |
| Routes           | `api/routes/*.mjs`  | Thin HTTP handlers: parse input, call domain, format JSON |
| Domain           | `api/domain/*.mjs`  | Data access + business rules (key construction, queries)  |
| Validation       | `api/validation/*`  | Request validation + response formatting                  |
| Services         | `api/services/*.mjs`| Shared infra: ddb, errors, http, events, id, time, logger |

Route handlers stay thin; all DynamoDB access lives in `api/domain`.

### Shared services

- `services/http-handler.mjs` — `createHttpRouterHandler` wraps the Router
  with CORS, correlation ids, OPTIONS short-circuit, and uniform
  `ApiError -> status` mapping.
- `services/http.mjs` — `jsonResponse`, `emptyResponse`, `parseBody`,
  `parseLimit`.
- `services/errors.mjs` — `ApiError` + typed subclasses
  (`BadRequest/Unauthorized/Forbidden/NotFound/Conflict/Upstream`).
- `services/ddb.mjs` — shared `DynamoDBDocumentClient` (`ddb`) +
  `TABLE_NAME`.
- `services/events.mjs` — `publishEvent(detailType, detail)` to the
  default EventBridge bus, source `homestead.api`.
- `services/id.mjs` — ULID generation (sortable by creation time).
- `services/time.mjs` — ISO timestamps + `yyyy-mm` partition helpers.
- `services/logger.mjs` — shared Powertools `Logger`.

## Authentication

`api/authorizer.mjs` is a Lambda **TOKEN** authorizer wired as the API's
`DefaultAuthorizer`. It verifies a Cognito **id token** with
[`aws-jwt-verify`][jwt] (`tokenUse: "id"`, `clientId`, `userPoolId`) and
returns an IAM allow/deny policy plus a context object
(`{ sub, email, authSource: "cognito" }`) the routes read from
`event.requestContext.authorizer`. The Cognito user pool is owned by
`rsc-core` and exported via SSM (`/readysetcloud/auth/user-pool-arn`,
`/readysetcloud/auth/user-pool-client-id`).

## Data store

A **single DynamoDB table** (`HomesteadTable`, `PAY_PER_REQUEST`) holds
every entity, with two global secondary indexes (**GSI1**, **GSI2**), a
stream (`NEW_AND_OLD_IMAGES`), and TTL on `expiresAt`.

### No-Scan rule

**Every read is a `GetItem` or a `Query`. There are no `Scan`s anywhere.**
Each access pattern maps to a partition on the base table or one of the
GSIs. The `ApiFunction` IAM policy deliberately omits `dynamodb:Scan` so a
Scan can never be introduced by accident. New access patterns must be
satisfied by an existing key or a new GSI key — see
[`DATA_MODEL.md`](./DATA_MODEL.md).

## Events

Domain mutations publish to the **default EventBridge bus** via
`publishEvent`, with source `homestead.api` and a per-event detail-type.
Downstream consumers subscribe by detail-type.

## Hosting

The dashboard UI (built separately under `ui/`, not part of the API
foundation) is served from a **private S3 bucket** fronted by a
**CloudFront distribution** using Origin Access Control. An optional
custom domain is gated behind the `DeployCustomDomain` condition
(`BaseCustomDomain` + `HostedZoneId` both set).

[router]: https://docs.powertools.aws.dev/lambda/typescript/latest/features/event-handler/api-gateway-rest/
[jwt]: https://github.com/awslabs/aws-jwt-verify
