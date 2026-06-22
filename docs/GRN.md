# Good Roots Network (GRN) integration

The garden pillar integrates two-way with the [Good Roots Network](https://github.com/allenheltondev/olivias-garden-foundation)
(GRN) API. **GRN is the single source of truth for crops, the crop catalog, and
garden beds** — the homestead keeps no local copies of those; it reaches them
through authenticated pass-through routes. It also publishes surplus harvests as
GRN listings and proxies GRN's browse / claim / request endpoints. The harvest
log is the one garden record that stays local (it references GRN crop ids). The
integration is **optional** — when it is not configured every GRN-backed
endpoint returns `503 GrnNotConfigured` and the daily claim-status sync is
skipped, so the rest of the API is unaffected.

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

- Every `/grn/*` pass-through (`/grn/crops*`, `/grn/catalog/crops*`,
  `/grn/beds*`, `/grn/my-listings`, `/grn/discover`, `/grn/requests`,
  `/grn/claims*`) → `503 GrnNotConfigured`.
- `POST /harvest-logs/{id}/publish`, `DELETE /harvest-logs/{id}/publish` →
  `503 GrnNotConfigured`.
- `GET /stats/garden` → still works; it only reads local harvest logs.
- The daily `AlertsFunction` claim-status sync is a no-op.

## Error mapping

The client (`api/lib/grn.mjs`) maps upstream failures to typed errors:

| Condition | Error | HTTP |
|-----------|-------|------|
| Missing base URL or token | `GrnNotConfiguredError` | 503 |
| Upstream `401` / `403` | `GrnUnauthorizedError` | 502 |
| Other upstream non-2xx / network error | `ApiError` (`GrnUpstream`) | 502 |

## Endpoints

### Crop library / catalog / garden beds (pass-through)

GRN owns these; the homestead forwards faithfully (query/pagination params, a
caller `Idempotency-Key` on writes) and returns GRN's response. Bodies are
validated lightly (shape/required per the GRN schemas) then sent verbatim.

| Homestead route | GRN operation | Notes |
|-----------------|---------------|-------|
| `GET /grn/crops` | `GET /crops` | list the caller's crop library (`GrowerCropItem[]`). |
| `POST /grn/crops` | `POST /crops` | body: `UpsertGrowerCropRequest` (required `status`, `visibility`, `surplus_enabled`, plus `canonical_id` **or** `crop_name`). |
| `GET /grn/crops/{id}` | `GET /crops/{cropLibraryId}` | one grower crop. |
| `PUT /grn/crops/{id}` | `PUT /crops/{cropLibraryId}` | update. |
| `DELETE /grn/crops/{id}` | `DELETE /crops/{cropLibraryId}` | delete (204). |
| `GET /grn/catalog/crops` | `GET /catalog/crops` | catalog crops (`CatalogCrop[]`). |
| `GET /grn/catalog/crops/{cropId}/varieties` | `GET /catalog/crops/{cropId}/varieties` | catalog varieties. |
| `GET /grn/beds` | `GET /beds` | list garden beds (`GardenBed[]`). |
| `POST /grn/beds` | `POST /beds` | body: `UpsertGardenBedRequest` (required `name`). |
| `GET /grn/beds/{id}` | `GET /beds/{bedId}` | one bed. |
| `PUT /grn/beds/{id}` | `PUT /beds/{bedId}` | update. |
| `DELETE /grn/beds/{id}` | `DELETE /beds/{bedId}` | archive/soft-delete (204). |

A `GrowerCropItem` links to the public catalog through **`canonical_id`** (the
catalog `cropId`; the legacy `crop_id` field is deprecated) and to a variety
through `variety_id`. The publish path below uses exactly these.

### Publish / unpublish surplus

- `POST /harvest-logs/{id}/publish` — builds a GRN `UpsertListingRequest` from
  the harvest and the request body, `POST`s it to GRN `/listings` with
  `Idempotency-Key: <harvestId>` (so retries are safe), then stores the
  returned `grnListingId` + `grnStatus = active` on the harvest. **The catalog
  `cropId` is resolved from the harvest's linked grower crop**, not the request
  body: the harvest's `cropLibraryId` -> GRN `GET /crops/{id}` ->
  `canonical_id` (cropId) + `variety_id` (varietyId). A harvest with **no**
  `cropLibraryId` is rejected with `422` ("link this harvest to a crop before
  sharing"), and a linked crop with no `canonical_id` is also `422`. This closes
  the prior gap where the publish body had to carry a raw `cropId` the harvest
  never recorded. The body supplies only the availability window (and optional
  pickup/contact fields + a `varietyId` override):

  ```json
  { "availableEnd": "2026-07-15", "availableStart": "2026-07-01",
    "quantityTotal": 5, "unit": "lb", "varietyId": "<optional override>",
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
  `paths/catalog.yaml`, `paths/crop-library.yaml` (`/crops`),
  `paths/garden.yaml` (`/beds`)
- `schemas/listings.yaml` (`UpsertListingRequest`, `ListingItem`,
  `PaginatedListings`), `schemas/claims.yaml` (`CreateClaimRequest`,
  `ClaimResponse`, `PaginatedClaims`), `schemas/requests.yaml`
  (`UpsertRequestPayload`, `RequestResponse`), `schemas/catalog.yaml`
  (`CatalogCrop`, `CatalogVariety`), `schemas/crop-library.yaml`
  (`UpsertGrowerCropRequest`, `GrowerCropItem` — `canonical_id` is the catalog
  cropId link, `crop_id` deprecated), `schemas/garden.yaml`
  (`UpsertGardenBedRequest`, `GardenBed`)
