import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { publishEvent } from "../services/events.mjs";
import {
  formatMilkLog,
  validateMilkLogCreate,
  validateMilkLogQuery,
} from "../validation/milk.mjs";
import {
  createMilkLog,
  deleteMilkLog,
  listMilkLogs,
} from "../domain/milk.mjs";

// Milk log routes. Handlers stay thin: validate -> domain -> format. Keys +
// access patterns live in api/domain/milk.mjs; every read is a GetItem or
// Query (no Scans).
export function registerMilkRoutes(app) {
  // POST /milk-logs -- record a milking and publish MilkLogged.
  app.post("/milk-logs", async ({ event }) => {
    const fields = validateMilkLogCreate(parseBody(event));
    const item = await createMilkLog(fields);

    await publishEvent("MilkLogged", {
      id: item.id,
      animalId: item.animalId ?? null,
      volume: item.volume,
      unit: item.unit,
      loggedAt: item.loggedAt,
    });

    return jsonResponse(201, formatMilkLog(item));
  });

  // GET /milk-logs?from=&to= -- date range (ISO date or YYYY-MM). Range ->
  // month-partition fan-out; no Scan.
  app.get("/milk-logs", async ({ event }) => {
    const filters = validateMilkLogQuery(event.queryStringParameters ?? {});
    const items = await listMilkLogs(filters);
    return jsonResponse(200, {
      milk_logs: items.map(formatMilkLog),
    });
  });

  // DELETE /milk-logs/{id} -- cleanup. Resolves the base-table key via the id
  // pointer (see domain/milk.mjs), so no Scan.
  app.delete("/milk-logs/:id", async ({ params }) => {
    await deleteMilkLog(params.id);
    return emptyResponse(204);
  });
}
