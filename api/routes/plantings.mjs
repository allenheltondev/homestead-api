import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { BadRequestError } from "../services/errors.mjs";
import {
  validatePlantingCreate,
  validatePlantingUpdate,
  validatePlantingQuery,
  formatPlanting,
} from "../validation/planting.mjs";
import {
  createPlanting,
  getPlanting,
  listPlantings,
  updatePlanting,
  deletePlanting,
} from "../domain/planting.mjs";
import { bedExists } from "../domain/beds.mjs";

// Planting routes. Handlers stay thin: validate -> domain -> format. Keys +
// access patterns live in api/domain/planting.mjs; every read is a GetItem or
// Query on a collection-partition GSI (no Scans).
export function registerPlantingRoutes(app) {
  app.post("/plantings", async ({ event }) => {
    const fields = validatePlantingCreate(parseBody(event));
    if (fields.bedId && !(await bedExists(fields.bedId))) {
      throw new BadRequestError(`bed ${fields.bedId} does not exist`);
    }
    const item = await createPlanting(fields);
    return jsonResponse(201, formatPlanting(item));
  });

  app.get("/plantings", async ({ event }) => {
    const filters = validatePlantingQuery(event.queryStringParameters ?? {});
    const items = await listPlantings(filters);
    return jsonResponse(200, { plantings: items.map(formatPlanting) });
  });

  app.get("/plantings/:id", async ({ params }) => {
    const item = await getPlanting(params.id);
    return jsonResponse(200, formatPlanting(item));
  });

  app.patch("/plantings/:id", async ({ event, params }) => {
    const fields = validatePlantingUpdate(parseBody(event));
    if (fields.bedId && !(await bedExists(fields.bedId))) {
      throw new BadRequestError(`bed ${fields.bedId} does not exist`);
    }
    const item = await updatePlanting(params.id, fields);
    return jsonResponse(200, formatPlanting(item));
  });

  app.delete("/plantings/:id", async ({ params }) => {
    await deletePlanting(params.id);
    return emptyResponse(204);
  });
}
