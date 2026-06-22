import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { publishEvent } from "../services/events.mjs";
import {
  formatIncubationBatch,
  validateIncubationCreate,
  validateIncubationHatch,
} from "../validation/incubation.mjs";
import {
  createIncubationBatch,
  deleteIncubationBatch,
  listIncubationBatches,
  recordHatch,
} from "../domain/incubation.mjs";

// Incubation batch routes. Handlers stay thin: validate -> domain -> format.
// Keys + access patterns live in api/domain/incubation.mjs; listing is a single
// GSI1 Query on the INCUBATION collection partition (no Scans).
export function registerIncubationRoutes(app) {
  // POST /incubation-batches -- start a batch and publish EggsSet.
  app.post("/incubation-batches", async ({ event }) => {
    const fields = validateIncubationCreate(parseBody(event));
    const item = await createIncubationBatch(fields);

    await publishEvent("EggsSet", {
      id: item.id,
      species: item.species,
      count: item.count,
      setAt: item.setAt,
      expectedHatchAt: item.expectedHatchAt,
    });

    return jsonResponse(201, formatIncubationBatch(item));
  });

  // GET /incubation-batches -- list all batches via GSI1 (no Scan).
  app.get("/incubation-batches", async () => {
    const items = await listIncubationBatches();
    return jsonResponse(200, {
      incubation_batches: items.map(formatIncubationBatch),
    });
  });

  // PATCH /incubation-batches/{id} -- record a hatch and publish Hatched.
  app.patch("/incubation-batches/:id", async ({ event, params }) => {
    const fields = validateIncubationHatch(parseBody(event));
    const item = await recordHatch(params.id, fields);

    await publishEvent("Hatched", {
      id: item.id,
      species: item.species,
      count: item.count,
      hatchedCount: item.hatchedCount,
      status: item.status,
    });

    return jsonResponse(200, formatIncubationBatch(item));
  });

  // DELETE /incubation-batches/{id} -- cleanup. Conditional delete (no Scan).
  app.delete("/incubation-batches/:id", async ({ params }) => {
    await deleteIncubationBatch(params.id);
    return emptyResponse(204);
  });
}
