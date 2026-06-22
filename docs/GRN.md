# Good Roots Network (GRN) integration

The garden pillar integrates with the [Good Roots Network](https://github.com/allenheltondev/olivias-garden-foundation)
(GRN) API. **GRN is the single source of truth for crops, the crop catalog,
garden beds, and harvests** — the homestead keeps no local copies of those; it
reaches them through authenticated pass-through routes. GRN records harvests
**per crop**, so the homestead no longer keeps a local harvest log. The
homestead also publishes surplus as GRN listings (crop-level) and proxies GRN's
browse / claim / request endpoints. The integration is **optional** — when it is
not configured every GRN-backed endpoint returns `503 GrnNotConfigured`, the
GRN-sourced garden stats / produce value degrade to empty (without failing the
broader `/stats/*` endpoints), and the daily claim-status sync is skipped, so the
rest of the API is unaffected.

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

- Every `/grn/*` pass-through (`/grn/crops*`, `/grn/crops/{id}/harvests`,
  `/grn/crops/{id}/publish-surplus`, `/grn/catalog/crops*`, `/grn/beds*`,
  `/grn/listings`, `/grn/listings/{id}`, `/grn/my-listings`, `/grn/discover`,
  `/grn/requests`, `/grn/claims*`) → `503 GrnNotConfigured`.
- `GET /stats/garden` → still responds `200` with an **empty garden**
  (`totalLbs: 0`, `byCrop: []`); it sources harvests from GRN and degrades
  rather than failing.
- `GET /stats/pnl` → still responds `200`; `outputs.produceValue` degrades to
  `0` (the rest of the P&L is unaffected).
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
| `GET /grn/crops/{id}/harvests` | `GET /crops/{cropLibraryId}/harvests` | the crop's harvest log: `HarvestLogResponse {growerCropId, totalHarvested (string), harvestCount, harvests: HarvestItem[]}`. |
| `POST /grn/crops/{id}/harvests` | `POST /crops/{cropLibraryId}/harvests` | record a harvest. body: `RecordHarvestRequest {amount* (>0), unit?, harvestedOn? (YYYY-MM-DD), notes?}` → `RecordHarvestResponse {harvest, totalHarvested, harvestCount}`. Forwards a caller `Idempotency-Key`. |
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

### Publish / unpublish surplus (crop-level)

Surplus is published as a GRN listing tied to a crop. There is no local harvest
log anymore, so the catalog `cropId` comes straight from the grower crop.

| Homestead route | GRN operation | Notes |
|-----------------|---------------|-------|
| `POST /grn/listings` | `POST /listings` | raw `UpsertListingRequest` pass-through (required `cropId` uuid, `quantityTotal` >0, `unit`, `availableEnd`). Forwards a caller `Idempotency-Key`. |
| `PUT /grn/listings/{id}` | `PUT /listings/{id}` | update a listing. **Unpublish** = `PUT` with `status = expired` (the GRN contract has no `DELETE /listings/{id}`). |
| `POST /grn/crops/{id}/publish-surplus` | `POST /listings` | convenience: fetch the grower crop, use its `canonical_id` as the listing `cropId` (+ `variety_id` → `varietyId`), merge the caller body, and POST `/listings`. |

The `publish-surplus` body supplies the quantity + availability window (and
optional pickup/contact fields + a `varietyId` override):

```json
{ "amount": 5, "availableEnd": "2026-07-15", "availableStart": "2026-07-01",
  "unit": "lb", "varietyId": "<optional override>",
  "pickupLocationText": "Front porch", "pickupDisclosurePolicy": "after_confirmed",
  "contactPref": "in_app" }
```

`unit` defaults to the crop's `default_unit` (else `lb`), `availableStart`
defaults to now, and `title` defaults to the crop's `nickname` / `crop_name`. A
crop with **no** `canonical_id` is rejected with `422` ("the crop has no catalog
entry yet; pick a catalog crop before sharing surplus").

### Browse / claim / requests (proxies)

| Homestead route | GRN operation | Notes |
|-----------------|---------------|-------|
| `GET /grn/my-listings?status=&limit=&offset=` | `GET /my/listings` | status ∈ active\|claimed\|expired |
| `GET /grn/discover?lat=&lng=&radius=` | `GET /listings/discover` | lat/lng are mapped to a coarse `geoKey`; `radius` → `radiusMiles`. An explicit `geoKey` is also accepted. |
| `GET /grn/requests?limit=&offset=` | `GET /requests` | |
| `POST /grn/claims` | `POST /claims` | body: `listingId` (uuid), `quantityClaimed` (>0), optional `requestId`/`notes`. Forwards a caller `Idempotency-Key` header. |
| `GET /grn/claims/{id}` | `GET /claims/{claimId}` | The GRN contract documents only `PUT` on this path; a read is attempted and any rejection surfaces as an upstream error. |

### GRN-sourced garden stats + produce value

`GET /stats/garden` and the `GET /stats/pnl` `outputs.produceValue` derive from
GRN, not a local store: list the user's crops (`GET /crops`), fetch each crop's
harvests (`GET /crops/{id}/harvests`), sum each harvest's `amount` by crop and
overall, and filter by `harvestedOn` falling within the period. `produceValue =
totalAmount × ProducePricePerLb`. The whole GRN read is wrapped: on
`GrnNotConfigured` / `GrnUnauthorized` it returns an empty garden (`totalLbs: 0`,
`byCrop: []`) / `produceValue 0` rather than failing `/stats/garden`,
`/stats/summary`, or `/stats/pnl`. The `byCrop` rows carry `cropName`
(`nickname` || `crop_name`), `cropLibraryId` (the GRN crop id), and `lbs`.

### Daily claim-status sync

There is no local harvest/listing store anymore. The scheduled `AlertsFunction`
calls `GET /my/listings?status=claimed` and, for each claimed listing, adds a
`HomesteadAlert` line and emits a `GrnListingClaimed` event. The whole block is
wrapped in try/catch so GRN being unreachable never breaks the alert run.

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
  cropId link, `crop_id` deprecated, `default_unit` seeds publish-surplus;
  `RecordHarvestRequest`, `RecordHarvestResponse`, `HarvestLogResponse`,
  `HarvestItem` for the per-crop harvest log), `schemas/garden.yaml`
  (`UpsertGardenBedRequest`, `GardenBed`)
