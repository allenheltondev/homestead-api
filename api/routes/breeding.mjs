import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { publishEvent } from "../services/events.mjs";
import {
  formatBreeding,
  validateBreedingCreate,
} from "../validation/breeding.mjs";
import {
  createBreeding,
  deleteBreeding,
  listBreedings,
} from "../domain/breeding.mjs";

// Breeding routes. Handlers stay thin: validate -> domain -> format. Keys +
// access patterns live in api/domain/breeding.mjs; listing is a single GSI1
// Query on the BREEDING collection partition (no Scans). The upcoming-breeding
// stats endpoint is registered under /stats (see routes/stats.mjs).
export function registerBreedingRoutes(app) {
  // POST /breedings -- record a breeding and publish BreedingRecorded.
  app.post("/breedings", async ({ event }) => {
    const fields = validateBreedingCreate(parseBody(event));
    const item = await createBreeding(fields);

    await publishEvent("BreedingRecorded", {
      id: item.id,
      species: item.species,
      damId: item.damId,
      sireId: item.sireId ?? null,
      bredAt: item.bredAt,
      expectedDueAt: item.expectedDueAt,
    });

    return jsonResponse(201, formatBreeding(item));
  });

  // GET /breedings -- list all breedings via GSI1 (no Scan).
  app.get("/breedings", async () => {
    const items = await listBreedings();
    return jsonResponse(200, {
      breedings: items.map(formatBreeding),
    });
  });

  // DELETE /breedings/{id} -- cleanup. Conditional delete (no Scan).
  app.delete("/breedings/:id", async ({ params }) => {
    await deleteBreeding(params.id);
    return emptyResponse(204);
  });
}
