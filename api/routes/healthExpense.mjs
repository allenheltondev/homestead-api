import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { publishEvent } from "../services/events.mjs";
import {
  formatHealthExpense,
  validateHealthExpenseCreate,
  validateHealthExpenseQuery,
} from "../validation/healthExpense.mjs";
import {
  createHealthExpense,
  deleteHealthExpense,
  listHealthExpenses,
} from "../domain/healthExpense.mjs";

// Health expense routes. Handlers stay thin: validate -> domain -> format.
// Keys + access patterns live in api/domain/healthExpense.mjs; every read is a
// GetItem or Query (no Scans).
export function registerHealthExpenseRoutes(app) {
  // POST /health-expenses — record an expense and publish HealthExpenseRecorded.
  app.post("/health-expenses", async ({ event }) => {
    const fields = validateHealthExpenseCreate(parseBody(event));
    const item = await createHealthExpense(fields);

    await publishEvent("HealthExpenseRecorded", formatHealthExpense(item));

    return jsonResponse(201, formatHealthExpense(item));
  });

  // GET /health-expenses?from=&to=&category= — date range (ISO date or
  // YYYY-MM), optional category filter. Range -> month-partition fan-out; no
  // Scan.
  app.get("/health-expenses", async ({ event }) => {
    const filters = validateHealthExpenseQuery(event.queryStringParameters ?? {});
    const items = await listHealthExpenses(filters);
    return jsonResponse(200, {
      health_expenses: items.map(formatHealthExpense),
    });
  });

  // DELETE /health-expenses/{id} — cleanup. Resolves the base-table key via
  // the id pointer (see domain/healthExpense.mjs), so no Scan.
  app.delete("/health-expenses/:id", async ({ params }) => {
    await deleteHealthExpense(params.id);
    return emptyResponse(204);
  });
}
