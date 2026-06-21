import {
  createPasture,
  deletePasture,
  getPasture,
  listPastureAnimals,
  listPastures,
  isConditionalCheckFailed,
} from "../domain/pasture.mjs";
import { parseBody, parseLimit, jsonResponse, emptyResponse } from "../services/http.mjs";
import { ConflictError } from "../services/errors.mjs";
import {
  formatPasture,
  formatPastureAnimal,
  validatePasturePayload,
} from "../validation/pasture.mjs";

// Pasture routes. Handlers stay thin: validate -> domain call -> format.
// Wired into the router with a single registerPastureRoutes call in
// routes/index.mjs.
export function registerPastureRoutes(app) {
  app.post("/pastures", async ({ event }) => {
    const body = parseBody(event);
    const fields = validatePasturePayload(body);
    try {
      const item = await createPasture(fields);
      return jsonResponse(201, formatPasture(item));
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        throw new ConflictError("pasture already exists");
      }
      throw err;
    }
  });

  app.get("/pastures", async ({ event }) => {
    const qs = event.queryStringParameters ?? {};
    const limit = parseLimit(qs.limit);
    const { items } = await listPastures({ limit });
    return jsonResponse(200, { pastures: items.map(formatPasture) });
  });

  app.get("/pastures/:id", async ({ params }) => {
    const pasture = await getPasture(params.id);
    return jsonResponse(200, formatPasture(pasture));
  });

  app.get("/pastures/:id/animals", async ({ params }) => {
    const items = await listPastureAnimals(params.id);
    return jsonResponse(200, {
      pastureId: params.id,
      animals: items.map(formatPastureAnimal),
    });
  });

  app.delete("/pastures/:id", async ({ params }) => {
    await deletePasture(params.id);
    return emptyResponse(204);
  });
}
