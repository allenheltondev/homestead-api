import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { publishEvent } from "../services/events.mjs";
import {
  formatFeedPurchase,
  validateFeedPurchaseCreate,
  validateFeedPurchaseQuery,
} from "../validation/feed.mjs";
import {
  createFeedPurchase,
  deleteFeedPurchase,
  listFeedPurchases,
} from "../domain/feed.mjs";

// Feed purchase routes. Handlers stay thin: validate -> domain -> format.
// Keys + access patterns live in api/domain/feed.mjs; every read is a
// GetItem or Query (no Scans).
export function registerFeedRoutes(app) {
  // POST /feed-purchases — record a purchase and publish FeedPurchased.
  app.post("/feed-purchases", async ({ event }) => {
    const fields = validateFeedPurchaseCreate(parseBody(event));
    const item = await createFeedPurchase(fields);

    // Publish the formatted shape so the event carries whichever fields the
    // payload set (legacy quantity/unit/vendor or the new bag fields).
    await publishEvent("FeedPurchased", formatFeedPurchase(item));

    return jsonResponse(201, formatFeedPurchase(item));
  });

  // GET /feed-purchases?from=&to=&type= — date range (ISO date or YYYY-MM),
  // optional type filter. range -> month-partition fan-out; type only ->
  // GSI1 Query.
  app.get("/feed-purchases", async ({ event }) => {
    const filters = validateFeedPurchaseQuery(event.queryStringParameters ?? {});
    const items = await listFeedPurchases(filters);
    return jsonResponse(200, {
      feed_purchases: items.map(formatFeedPurchase),
    });
  });

  // DELETE /feed-purchases/{id} — cleanup. Resolves the base-table key via
  // the id pointer (see domain/feed.mjs), so no Scan.
  app.delete("/feed-purchases/:id", async ({ params }) => {
    await deleteFeedPurchase(params.id);
    return emptyResponse(204);
  });
}
