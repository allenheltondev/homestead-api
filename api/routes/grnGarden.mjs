import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import {
  validateGrowerCropUpsert,
  validateGardenBedUpsert,
  validateListQuery,
} from "../validation/grnGarden.mjs";
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
