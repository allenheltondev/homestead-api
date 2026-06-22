import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { publishEvent } from "../services/events.mjs";
import {
  formatSale,
  validateSaleCreate,
  validateSaleQuery,
} from "../validation/sales.mjs";
import {
  createSale,
  deleteSale,
  listSales,
} from "../domain/sales.mjs";

// Sales routes. Handlers stay thin: validate -> domain -> format. Keys +
// access patterns live in api/domain/sales.mjs; every read is a GetItem or
// Query (no Scans).
export function registerSalesRoutes(app) {
  // POST /sales -- record a sale and publish SaleRecorded.
  app.post("/sales", async ({ event }) => {
    const fields = validateSaleCreate(parseBody(event));
    const item = await createSale(fields);

    await publishEvent("SaleRecorded", {
      id: item.id,
      item: item.item,
      amount: item.amount,
      quantity: item.quantity ?? null,
      soldAt: item.soldAt,
    });

    return jsonResponse(201, formatSale(item));
  });

  // GET /sales?from=&to= -- date range (ISO date or YYYY-MM). Range ->
  // month-partition fan-out; no Scan.
  app.get("/sales", async ({ event }) => {
    const filters = validateSaleQuery(event.queryStringParameters ?? {});
    const items = await listSales(filters);
    return jsonResponse(200, {
      sales: items.map(formatSale),
    });
  });

  // DELETE /sales/{id} -- cleanup. Resolves the base-table key via the id
  // pointer (see domain/sales.mjs), so no Scan.
  app.delete("/sales/:id", async ({ params }) => {
    await deleteSale(params.id);
    return emptyResponse(204);
  });
}
