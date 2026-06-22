import { jsonResponse } from "../services/http.mjs";
import { BadRequestError } from "../services/errors.mjs";
import { gardenStats, monthsForPeriod } from "../domain/stats.mjs";
import { yyyymm } from "../services/time.mjs";

// Garden read routes: harvest stats. All harvest aggregation lives in
// api/domain/stats.mjs (no Scans). Crops, the catalog, and garden beds now live
// in the Good Roots Network and are reached via the /grn/* pass-through routes
// (api/routes/grnGarden.mjs).
export function registerGardenRoutes(app) {
  // GET /stats/garden?period=YYYY-MM|YYYY — harvest total by crop for the
  // period.
  app.get("/stats/garden", async ({ event }) => {
    const period = event?.queryStringParameters?.period ?? yyyymm();
    const months = monthsForPeriod(period);
    if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    return jsonResponse(200, await gardenStats(period, months));
  });
}
