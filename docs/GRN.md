# Good Roots Network (GRN) integration

The garden pillar integrates two-way with the [Good Roots Network](https://github.com/allenheltondev/olivias-garden-foundation)
(GRN) API: it publishes surplus harvests as GRN listings and proxies GRN's
browse / claim / request endpoints. The integration is **optional** — when it
is not configured every GRN-backed endpoint returns `503 GrnNotConfigured` and
the daily claim-status sync is skipped, so the rest of the API is unaffected.

## Configuration

Two pieces of config, both surfaced as CloudFormation parameters in
`template.yaml` and as env vars on the `ApiFunction` and `AlertsFunction`:

| Parameter | Env var | Default | Purpose |
|-----------|---------|---------|---------|
| `GrnApiBaseUrl` | `GRN_API_BASE_URL` | `""` (disabled) | Base URL of the GRN API, e.g. `https://api.goodroots.example`. |
| `GrnApiTokenSsmPath` | `GRN_API_TOKEN_SSM_PATH` | `/homestead/grn/token` | SSM SecureString path holding the GRN bearer token. |
| `ProducePricePerLb` | `PRODUCE_PRICE_PER_LB` | `"0"` | Price per lb for the P&L `produceValue` tie-in (unrelated to GRN auth, listed for completeness). |

### Setting it up

1. **Store the token** as an SSM SecureString (encrypted with the default
   `aws/ssm` KMS key or a CMK SSM is configured to use):

   ```sh
   aws ssm put-parameter \
     --name /homestead/grn/token \
     --type SecureString \
     --value "<your-grn-bearer-token>" \
     --overwrite
   ```

2. **Set the base URL** at deploy time, e.g.:

   ```sh
   sam deploy --parameter-overrides \
     GrnApiBaseUrl=https://api.goodroots.example \
     GrnApiTokenSsmPath=/homestead/grn/token
   ```

The token is fetched at runtime with `ssm:GetParameter` `WithDecryption` and
**cached in module scope for ~5 minutes**, so rotating the value in SSM takes
effect on the next cache expiry **without a redeploy**. Both functions are
granted `ssm:GetParameter` on the token path plus `kms:Decrypt` scoped (via
`kms:ViaService`) to the SSM service.

> **Networking:** GRN calls go out over the default Lambda networking (no VPC),
> which has internet egress. No NAT/VPC endpoints are required.

## Behaviour when unconfigured

- `GET /grn/my-listings`, `GET /grn/discover`, `GET /grn/requests`,
  `POST /grn/claims`, `GET /grn/claims/{id}` → `503 GrnNotConfigured`.
- `POST /harvest-logs/{id}/publish`, `DELETE /harvest-logs/{id}/publish` →
  `503 GrnNotConfigured`.
- `GET /garden/calendar` → still returns the **local** seasonal calendar; the
  GRN crop-catalog enrichment is simply skipped.
- The daily `AlertsFunction` claim-status sync is a no-op.

## Error mapping

The client (`api/lib/grn.mjs`) maps upstream failures to typed errors:

| Condition | Error | HTTP |
|-----------|-------|------|
| Missing base URL or token | `GrnNotConfiguredError` | 503 |
| Upstream `401` / `403` | `GrnUnauthorizedError` | 502 |
| Other upstream non-2xx / network error | `ApiError` (`GrnUpstream`) | 502 |

## Endpoints

### Publish / unpublish surplus

- `POST /harvest-logs/{id}/publish` — builds a GRN `UpsertListingRequest` from
  the harvest and the request body, `POST`s it to GRN `/listings` with
  `Idempotency-Key: <harvestId>` (so retries are safe), then stores the
  returned `grnListingId` + `grnStatus = active` on the harvest. The harvest
  only carries a crop **name**, so the request body must supply the GRN catalog
  `cropId` (UUID) and the availability window:

  ```json
  { "cropId": "<grn-crop-uuid>", "varietyId": "<optional>", "availableEnd": "2026-07-15",
    "availableStart": "2026-07-01", "quantityTotal": 5, "unit": "lb",
    "pickupLocationText": "Front porch", "pickupDisclosurePolicy": "after_confirmed",
    "contactPref": "in_app" }
  ```

  Quantity/unit/availableStart/title default from the harvest when omitted.

- `DELETE /harvest-logs/{id}/publish` — retires the listing upstream (the GRN
  contract has no `DELETE /listings/{id}`, so this `PUT`s `status = expired` via
  `updateListing`) and clears the local `grnListingId` / `grnStatus`.

### Browse / claim / requests (proxies)

| Homestead route | GRN operation | Notes |
|-----------------|---------------|-------|
| `GET /grn/my-listings?status=&limit=&offset=` | `GET /my/listings` | status ∈ active\|claimed\|expired |
| `GET /grn/discover?lat=&lng=&radius=` | `GET /listings/discover` | lat/lng are mapped to a coarse `geoKey`; `radius` → `radiusMiles`. An explicit `geoKey` is also accepted. |
| `GET /grn/requests?limit=&offset=` | `GET /requests` | |
| `POST /grn/claims` | `POST /claims` | body: `listingId` (uuid), `quantityClaimed` (>0), optional `requestId`/`notes`. Forwards a caller `Idempotency-Key` header. |
| `GET /grn/claims/{id}` | `GET /claims/{claimId}` | The GRN contract documents only `PUT` on this path; a read is attempted and any rejection surfaces as an upstream error. |

### Daily claim-status sync

The scheduled `AlertsFunction` calls `GET /my/listings`, and for each locally
linked harvest whose listing status changed it updates `grnStatus`, adds a
`HomesteadAlert` line, and (for newly `claimed` listings) emits a
`GrnListingClaimed` event. The whole block is wrapped in try/catch so GRN being
unreachable never breaks the alert run.

## GRN contract files mapped

Built against these files from the GRN OpenAPI tree
(`services/grn-api/openapi/`):

- `openapi.yaml` (path index)
- `paths/listings.yaml`, `paths/requests.yaml`, `paths/claims.yaml`,
  `paths/catalog.yaml`
- `schemas/listings.yaml` (`UpsertListingRequest`, `ListingItem`,
  `PaginatedListings`), `schemas/claims.yaml` (`CreateClaimRequest`,
  `ClaimResponse`, `PaginatedClaims`), `schemas/requests.yaml`
  (`UpsertRequestPayload`, `RequestResponse`), `schemas/catalog.yaml`
  (`CatalogCrop`, `CatalogVariety`)
