import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { publishEvent } from "../services/events.mjs";
import {
  formatEggCollection,
  validateEggCollectionCreate,
  validateEggCollectionQuery,
} from "../validation/eggs.mjs";
import {
  createEggCollection,
  deleteEggCollection,
  listEggCollections,
} from "../domain/eggs.mjs";

// Egg collection routes. Handlers stay thin: validate -> domain -> format.
// Keys + access patterns live in api/domain/eggs.mjs; every read is a GetItem
// or Query (no Scans).
export function registerEggRoutes(app) {
  // POST /egg-collections — record a collection and publish EggsCollected.
  app.post("/egg-collections", async ({ event }) => {
    const fields = validateEggCollectionCreate(parseBody(event));
    const item = await createEggCollection(fields);

    await publishEvent("EggsCollected", {
      id: item.id,
      count: item.count,
      collectedAt: item.collectedAt,
      coop: item.coop ?? null,
    });

    return jsonResponse(201, formatEggCollection(item));
  });

  // GET /egg-collections?from=&to= — date range (ISO date or YYYY-MM).
  // Range -> month-partition fan-out; no Scan.
  app.get("/egg-collections", async ({ event }) => {
    const filters = validateEggCollectionQuery(event.queryStringParameters ?? {});
    const items = await listEggCollections(filters);
    return jsonResponse(200, {
      egg_collections: items.map(formatEggCollection),
    });
  });

  // DELETE /egg-collections/{id} — cleanup. Resolves the base-table key via
  // the id pointer (see domain/eggs.mjs), so no Scan.
  app.delete("/egg-collections/:id", async ({ params }) => {
    await deleteEggCollection(params.id);
    return emptyResponse(204);
  });
}
