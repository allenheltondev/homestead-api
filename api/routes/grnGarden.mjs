import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { UnprocessableEntityError } from "../services/errors.mjs";
import {
  validateGrowerCropUpsert,
  validateGardenBedUpsert,
  validateListQuery,
} from "../validation/grnGarden.mjs";
import {
  validateRecordHarvest,
  validateListingUpsert,
  buildSurplusListingPayload,
} from "../validation/grn.mjs";
import {
  listGrowerCrops,
  createGrowerCrop,
  getGrowerCrop,
  updateGrowerCrop,
  deleteGrowerCrop,
  listGrowerBeds,
  createGrowerBed,
  getGrowerBed,
  updateGrowerBed,
  deleteGrowerBed,
  listCatalogCrops,
  listCatalogVarieties,
  listCropHarvests,
  recordCropHarvest,
  createListing,
  updateListing,
} from "../lib/grn.mjs";

// Good Roots Network (GRN) crop-library / catalog / garden-bed pass-through
// routes. GRN is the single source of truth for crops, catalog, and beds; these
// handlers authenticate the homestead caller (same as every other route), let
// the GRN client (api/lib/grn.mjs) inject the GRN bearer token, forward
// query/pagination params + a caller Idempotency-Key on writes, and return the
// upstream JSON unchanged. The client throws the typed GRN errors
// (GrnNotConfigured -> 503, GrnUnauthorized -> 502, other upstream -> 502).
export function registerGrnGardenRoutes(app) {
  // --- Crop library (GRN /crops) ----------------------------------------
  // GET /grn/crops -> GET /crops.
  app.get("/grn/crops", async ({ event }) => {
    const query = validateListQuery(event.queryStringParameters ?? {});
    const correlationId = event?.requestContext?.requestId;
    const result = await listGrowerCrops({ query, correlationId });
    return jsonResponse(200, result);
  });

  // POST /grn/crops -> POST /crops (UpsertGrowerCropRequest).
  app.post("/grn/crops", async ({ event }) => {
    const payload = validateGrowerCropUpsert(parseBody(event));
    const correlationId = event?.requestContext?.requestId;
    const idempotencyKey = headerValue(event, "idempotency-key");
    const result = await createGrowerCrop(payload, { idempotencyKey, correlationId });
    return jsonResponse(201, result);
  });

  // GET /grn/crops/{id} -> GET /crops/{cropLibraryId}.
  app.get("/grn/crops/:id", async ({ event, params }) => {
    const correlationId = event?.requestContext?.requestId;
    const result = await getGrowerCrop(params.id, { correlationId });
    return jsonResponse(200, result);
  });

  // PUT /grn/crops/{id} -> PUT /crops/{cropLibraryId}.
  app.put("/grn/crops/:id", async ({ event, params }) => {
    const payload = validateGrowerCropUpsert(parseBody(event));
    const correlationId = event?.requestContext?.requestId;
    const idempotencyKey = headerValue(event, "idempotency-key");
    const result = await updateGrowerCrop(params.id, payload, { idempotencyKey, correlationId });
    return jsonResponse(200, result);
  });

  // DELETE /grn/crops/{id} -> DELETE /crops/{cropLibraryId}.
  app.delete("/grn/crops/:id", async ({ event, params }) => {
    const correlationId = event?.requestContext?.requestId;
    await deleteGrowerCrop(params.id, { correlationId });
    return emptyResponse(204);
  });

  // --- Crop harvests (GRN /crops/{id}/harvests) -------------------------
  // GRN records harvests per crop. These are thin pass-throughs over the
  // listCropHarvests / recordCropHarvest contract operations.

  // GET /grn/crops/{id}/harvests -> GET /crops/{cropLibraryId}/harvests
  // (returns a HarvestLogResponse).
  app.get("/grn/crops/:id/harvests", async ({ event, params }) => {
    const correlationId = event?.requestContext?.requestId;
    const result = await listCropHarvests(params.id, { correlationId });
    return jsonResponse(200, result);
  });

  // POST /grn/crops/{id}/harvests -> POST /crops/{cropLibraryId}/harvests
  // (body: RecordHarvestRequest; returns a RecordHarvestResponse). Forwards a
  // caller Idempotency-Key so a retried record is safe.
  app.post("/grn/crops/:id/harvests", async ({ event, params }) => {
    const payload = validateRecordHarvest(parseBody(event));
    const correlationId = event?.requestContext?.requestId;
    const idempotencyKey = headerValue(event, "idempotency-key");
    const result = await recordCropHarvest(params.id, payload, { idempotencyKey, correlationId });
    return jsonResponse(201, result);
  });

  // POST /grn/crops/{id}/publish-surplus — convenience: fetch the grower crop,
  // resolve its catalog cropId (canonical_id) + variety (variety_id), merge the
  // caller-supplied {amount, availableEnd, pickup..., varietyId?}, and POST a
  // GRN /listings. 422 when the crop has no canonical_id (no catalog link yet).
  app.post("/grn/crops/:id/publish-surplus", async ({ event, params }) => {
    const correlationId = event?.requestContext?.requestId;
    const growerCrop = await getGrowerCrop(params.id, { correlationId });
    const cropId = growerCrop?.canonical_id ?? null;
    if (!cropId) {
      throw new UnprocessableEntityError(
        "the crop has no catalog entry yet; pick a catalog crop before sharing surplus",
      );
    }
    const payload = buildSurplusListingPayload(growerCrop, parseBody(event), { cropId });
    const idempotencyKey = headerValue(event, "idempotency-key");
    const listing = await createListing(payload, { idempotencyKey, correlationId });
    return jsonResponse(201, listing);
  });

  // --- Listings (GRN /listings) -----------------------------------------
  // POST /grn/listings -> POST /listings (UpsertListingRequest). Forwards a
  // caller Idempotency-Key.
  app.post("/grn/listings", async ({ event }) => {
    const payload = validateListingUpsert(parseBody(event));
    const correlationId = event?.requestContext?.requestId;
    const idempotencyKey = headerValue(event, "idempotency-key");
    const listing = await createListing(payload, { idempotencyKey, correlationId });
    return jsonResponse(201, listing);
  });

  // PUT /grn/listings/{id} -> PUT /listings/{id} (UpsertListingRequest).
  // Unpublishing is just a PUT with status=expired.
  app.put("/grn/listings/:id", async ({ event, params }) => {
    const payload = validateListingUpsert(parseBody(event));
    const correlationId = event?.requestContext?.requestId;
    const idempotencyKey = headerValue(event, "idempotency-key");
    const listing = await updateListing(params.id, payload, { idempotencyKey, correlationId });
    return jsonResponse(200, listing);
  });

  // --- Catalog (GRN /catalog/crops) -------------------------------------
  // GET /grn/catalog/crops -> GET /catalog/crops.
  app.get("/grn/catalog/crops", async ({ event }) => {
    const correlationId = event?.requestContext?.requestId;
    const result = await listCatalogCrops({ correlationId });
    return jsonResponse(200, result);
  });

  // GET /grn/catalog/crops/{cropId}/varieties -> GET the catalog varieties.
  app.get("/grn/catalog/crops/:cropId/varieties", async ({ event, params }) => {
    const correlationId = event?.requestContext?.requestId;
    const result = await listCatalogVarieties(params.cropId, { correlationId });
    return jsonResponse(200, result);
  });

  // --- Garden beds (GRN /beds) ------------------------------------------
  // GET /grn/beds -> GET /beds.
  app.get("/grn/beds", async ({ event }) => {
    const query = validateListQuery(event.queryStringParameters ?? {});
    const correlationId = event?.requestContext?.requestId;
    const result = await listGrowerBeds({ query, correlationId });
    return jsonResponse(200, result);
  });

  // POST /grn/beds -> POST /beds (UpsertGardenBedRequest).
  app.post("/grn/beds", async ({ event }) => {
    const payload = validateGardenBedUpsert(parseBody(event));
    const correlationId = event?.requestContext?.requestId;
    const idempotencyKey = headerValue(event, "idempotency-key");
    const result = await createGrowerBed(payload, { idempotencyKey, correlationId });
    return jsonResponse(201, result);
  });

  // GET /grn/beds/{id} -> GET /beds/{bedId}.
  app.get("/grn/beds/:id", async ({ event, params }) => {
    const correlationId = event?.requestContext?.requestId;
    const result = await getGrowerBed(params.id, { correlationId });
    return jsonResponse(200, result);
  });

  // PUT /grn/beds/{id} -> PUT /beds/{bedId}.
  app.put("/grn/beds/:id", async ({ event, params }) => {
    const payload = validateGardenBedUpsert(parseBody(event));
    const correlationId = event?.requestContext?.requestId;
    const idempotencyKey = headerValue(event, "idempotency-key");
    const result = await updateGrowerBed(params.id, payload, { idempotencyKey, correlationId });
    return jsonResponse(200, result);
  });

  // DELETE /grn/beds/{id} -> DELETE /beds/{bedId} (archive/soft-delete).
  app.delete("/grn/beds/:id", async ({ event, params }) => {
    const correlationId = event?.requestContext?.requestId;
    await deleteGrowerBed(params.id, { correlationId });
    return emptyResponse(204);
  });
}

// Case-insensitive header lookup over the proxy event's headers map.
function headerValue(event, name) {
  const headers = event?.headers ?? {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}
