import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { publishEvent } from "../services/events.mjs";
import {
  formatFeedConsumption,
  validateFeedConsumptionCreate,
  validateFeedConsumptionQuery,
} from "../validation/feedConsumption.mjs";
import {
  createFeedConsumption,
  deleteFeedConsumption,
  listFeedConsumption,
} from "../domain/feedConsumption.mjs";

// Feed consumption routes. Handlers stay thin: validate -> domain -> format.
// Keys + access patterns live in api/domain/feedConsumption.mjs; every read is
// a GetItem or Query (no Scans).
export function registerFeedConsumptionRoutes(app) {
  // POST /feed-consumption — record usage and publish FeedConsumed. Accepts
  // { feedType, lbs } or { feedType, bags, bagWeightLbs } (lbs derived).
  app.post("/feed-consumption", async ({ event }) => {
    const fields = validateFeedConsumptionCreate(parseBody(event));
    const item = await createFeedConsumption(fields);

    await publishEvent("FeedConsumed", formatFeedConsumption(item));

    return jsonResponse(201, formatFeedConsumption(item));
  });

  // GET /feed-consumption?from=&to=&type= — date range (ISO date or YYYY-MM),
  // optional type filter. Range -> month-partition fan-out; no Scan.
  app.get("/feed-consumption", async ({ event }) => {
    const filters = validateFeedConsumptionQuery(event.queryStringParameters ?? {});
    const items = await listFeedConsumption(filters);
    return jsonResponse(200, {
      feed_consumption: items.map(formatFeedConsumption),
    });
  });

  // DELETE /feed-consumption/{id} — cleanup. Resolves the base-table key via
  // the id pointer (see domain/feedConsumption.mjs), so no Scan.
  app.delete("/feed-consumption/:id", async ({ params }) => {
    await deleteFeedConsumption(params.id);
    return emptyResponse(204);
  });
}
