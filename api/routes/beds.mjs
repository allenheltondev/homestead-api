import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { ConflictError } from "../services/errors.mjs";
import {
  validateBedCreate,
  validateBedUpdate,
  formatBed,
} from "../validation/beds.mjs";
import {
  createBed,
  getBed,
  listBeds,
  updateBed,
  deleteBed,
} from "../domain/beds.mjs";

// Garden bed routes. Handlers stay thin: validate -> domain -> format. Keys +
// access patterns live in api/domain/beds.mjs; every read is a GetItem or
// Query on a collection-partition GSI (no Scans).
export function registerBedRoutes(app) {
  app.post("/beds", async ({ event }) => {
    const fields = validateBedCreate(parseBody(event));
    try {
      const item = await createBed(fields);
      return jsonResponse(201, formatBed(item));
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException || err?.name === "ConditionalCheckFailedException") {
        throw new ConflictError("bed already exists");
      }
      throw err;
    }
  });

  app.get("/beds", async () => {
    const { items } = await listBeds();
    return jsonResponse(200, { beds: items.map(formatBed) });
  });

  app.get("/beds/:id", async ({ params }) => {
    const item = await getBed(params.id);
    return jsonResponse(200, formatBed(item));
  });

  app.patch("/beds/:id", async ({ event, params }) => {
    const fields = validateBedUpdate(parseBody(event));
    const item = await updateBed(params.id, fields);
    return jsonResponse(200, formatBed(item));
  });

  app.delete("/beds/:id", async ({ params }) => {
    await deleteBed(params.id);
    return emptyResponse(204);
  });
}
