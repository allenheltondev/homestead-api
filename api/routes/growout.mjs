import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { publishEvent } from "../services/events.mjs";
import {
  formatGrowout,
  validateGrowoutCreate,
  validateGrowoutProcess,
} from "../validation/growout.mjs";
import {
  createGrowout,
  deleteGrowout,
  listGrowouts,
  recordProcessing,
} from "../domain/growout.mjs";

// Grow-out routes. Handlers stay thin: validate -> domain -> format. Keys +
// access patterns live in api/domain/growout.mjs; listing is a single GSI1
// Query on the GROWOUT collection partition (no Scans).
export function registerGrowoutRoutes(app) {
  // POST /growout -- start a grow-out batch and publish GrowoutStarted.
  app.post("/growout", async ({ event }) => {
    const fields = validateGrowoutCreate(parseBody(event));
    const item = await createGrowout(fields);

    await publishEvent("GrowoutStarted", {
      id: item.id,
      species: item.species,
      count: item.count,
      purpose: item.purpose,
      startedAt: item.startedAt,
    });

    return jsonResponse(201, formatGrowout(item));
  });

  // GET /growout -- list all batches via GSI1 (no Scan).
  app.get("/growout", async () => {
    const items = await listGrowouts();
    return jsonResponse(200, {
      growout_batches: items.map(formatGrowout),
    });
  });

  // PATCH /growout/{id}/process -- record processing and publish GrowoutProcessed.
  app.patch("/growout/:id/process", async ({ event, params }) => {
    const fields = validateGrowoutProcess(parseBody(event));
    const item = await recordProcessing(params.id, fields);

    await publishEvent("GrowoutProcessed", {
      id: item.id,
      species: item.species,
      processedCount: item.processedCount ?? null,
      dressedWeightLbsTotal: item.dressedWeightLbsTotal,
      processedAt: item.processedAt,
    });

    return jsonResponse(200, formatGrowout(item));
  });

  // DELETE /growout/{id} -- cleanup. Conditional delete (no Scan).
  app.delete("/growout/:id", async ({ params }) => {
    await deleteGrowout(params.id);
    return emptyResponse(204);
  });
}
