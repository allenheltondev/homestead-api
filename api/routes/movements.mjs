import {
  moveAnimal,
  listAnimalMoves,
  deleteMove,
} from "../domain/movement.mjs";
import { parseBody, parseLimit, jsonResponse, emptyResponse } from "../services/http.mjs";
import { formatMove, validateMovePayload } from "../validation/movement.mjs";

// Animal-movement routes. A move is a TransactWrite (history event +
// pasture-pointer upsert) handled in the domain layer; handlers stay thin.
export function registerMovementRoutes(app) {
  app.post("/animals/:id/moves", async ({ event, params }) => {
    const body = parseBody(event);
    const fields = validateMovePayload(body);
    const move = await moveAnimal(params.id, fields);
    return jsonResponse(201, formatMove(move));
  });

  app.get("/animals/:id/moves", async ({ event, params }) => {
    const qs = event.queryStringParameters ?? {};
    const limit = parseLimit(qs.limit);
    const { items } = await listAnimalMoves(params.id, { limit });
    return jsonResponse(200, {
      animalId: params.id,
      moves: items.map(formatMove),
    });
  });

  // Cleanup route for an individual move-history event.
  app.delete("/animals/:id/moves/:ts", async ({ params }) => {
    await deleteMove(params.id, decodeURIComponent(params.ts));
    return emptyResponse(204);
  });
}
