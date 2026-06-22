# homestead-api

API for tracking homestead information — animals, pastures, animal moves,
lifecycle events, and feed purchases. A serverless AWS SAM application: a
single Lambda routed by Lambda Powertools behind a Cognito-authorized REST
API, backed by a single-table DynamoDB design.

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and
[`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md) for design details.

## Local development

Requires Node 22+.

```bash
npm install        # install dependencies
npm run lint       # eslint over **/*.mjs
npm test           # unit tests only (tests/unit)
```

`npm test` runs **unit tests only**. Integration tests
(`tests/integration`) require a deployed staging stack and a Cognito test
user, so they run separately via `npm run test:integration` (CI invokes
this after a staging deploy; you cannot run it locally without the env
below).

```bash
npm run build      # sam build --parallel (requires the SAM CLI)
```

## Deploy model

Deploys are driven by GitHub Actions:

- **CI** (`.github/workflows/ci.yml`) — runs on every PR and on
  `push: main`. Lint + unit tests. This is the gating check for merges.
- **Staging** (`.github/workflows/deploy.yml`) — on PRs targeting `main`
  (and `workflow_dispatch`). Builds, deploys to the shared `homestead-api`
  staging stack, then runs the integration tests against it.
- **Production** (`.github/workflows/prod-deploy.yml`) — on `push: main`
  (and `workflow_dispatch`). Deploys to production.

So: **PR -> staging, merge to main -> production.**

## Enabling deploys

Deploys are **disabled by default**. Both deploy workflows are gated on a
repo variable so they stay skipped (and green) until you opt in.

1. **Enable the gate** — set repo variable `DEPLOYMENTS_ENABLED` to
   `true` (Settings -> Secrets and variables -> Actions -> Variables).
   Until this is `true`, the deploy jobs are skipped.

2. **OIDC deploy role** — create an IAM role GitHub Actions can assume via
   OIDC and store its ARN as the secret `AWS_DEPLOY_ROLE_ARN`.

3. **GitHub Environments** — create `Staging` and `Production`
   environments (optionally with protection rules).

### Variables and secrets

| Name                  | Kind     | Scope                | Purpose                                          |
| --------------------- | -------- | -------------------- | ------------------------------------------------ |
| `DEPLOYMENTS_ENABLED` | Variable | Repo                 | Master switch; `true` enables both deploy jobs   |
| `USER_POOL_ID`        | Variable | Repo / Environment   | Cognito user pool id (authorizer JWKS)           |
| `USER_POOL_CLIENT_ID` | Variable | Repo / Environment   | Cognito app client id (authorizer aud check)     |
| `BASE_CUSTOM_DOMAIN`  | Variable | Production env       | Optional custom domain apex (prod only)          |
| `HOSTED_ZONE_ID`      | Variable | Production env       | Route53 zone for the custom domain (prod only)   |
| `AWS_DEPLOY_ROLE_ARN` | Secret   | Repo / Environment   | OIDC role the workflows assume                    |
| `TEST_USERNAME`       | Secret   | Staging env          | Cognito test user for integration tests          |
| `TEST_PASSWORD`       | Secret   | Staging env          | Cognito test user password                       |

The Cognito user pool itself is owned by `rsc-core` and resolved at
deploy time from SSM (`/readysetcloud/auth/user-pool-arn`); no override
needed for `CognitoUserPoolArn`.

## Project layout

```
api/
  index.mjs          Lambda entry (wraps the Powertools Router)
  app.mjs            Router + notFound + errorHandler
  authorizer.mjs     Cognito id-token Lambda authorizer
  copilot.mjs        Read-only farm copilot (POST /copilot) — Bedrock Nova Pro
  copilot/tools.mjs  Read-only tool registry the copilot loop drives
  routes/            HTTP route handlers (index.mjs aggregates them)
  domain/            Data access + business rules
  validation/        Request validation / response formatting
  services/          Shared infra (ddb, errors, http, events, id, time, logger)
tests/
  unit/              Jest unit tests (npm test)
  integration/       Integration harness (npm run test:integration)
docs/                Architecture + data model
template.yaml        SAM infrastructure
samconfig.toml       SAM deploy config (ci / prod environments)
```
