import { jsonResponse } from "../services/http.mjs";
import { BadRequestError } from "../services/errors.mjs";
import { gardenStats, monthsForPeriod } from "../domain/stats.mjs";
import { gardenCalendar } from "../domain/plantingCalendar.mjs";
import { isGrnConfigured, listCatalogCrops } from "../lib/grn.mjs";
import { yyyymm } from "../services/time.mjs";
import { logger } from "../services/logger.mjs";

// Garden read routes: harvest stats and the local planting calendar (with
// optional, best-effort GRN crop-catalog enrichment). All harvest aggregation
// lives in api/domain/stats.mjs (no Scans); the calendar is a local static
// table (api/domain/plantingCalendar.mjs).
export function registerGardenRoutes(app) {
  // GET /stats/garden?period=YYYY-MM|YYYY — harvest total by crop + yield per
  // bed for the period.
  app.get("/stats/garden", async ({ event }) => {
    const period = event?.queryStringParameters?.period ?? yyyymm();
    const months = monthsForPeriod(period);
    if (!months) throw new BadRequestError("period must be YYYY-MM or YYYY");
    return jsonResponse(200, await gardenStats(period, months));
  });

  // GET /garden/calendar?zone= — local seasonal planting windows for the zone.
  // When GRN is configured, the response is best-effort enriched with the GRN
  // crop catalog (matched by crop name); GRN being down/unconfigured never
  // fails the request.
  app.get("/garden/calendar", async ({ event }) => {
    const zone = event?.queryStringParameters?.zone;
    const calendar = gardenCalendar(zone);

    let catalog = null;
    if (isGrnConfigured()) {
      try {
        const correlationId = event?.requestContext?.requestId;
        const crops = await listCatalogCrops({ correlationId });
        const items = Array.isArray(crops) ? crops : crops?.items;
        if (Array.isArray(items)) {
          catalog = enrichCrops(calendar.crops, items);
        }
      } catch (err) {
        // Best-effort only: log and fall back to the local calendar.
        logger.warn("GRN catalog enrichment skipped", { error: err?.message });
      }
    }

    return jsonResponse(200, {
      zone: calendar.zone,
      requestedZone: calendar.requestedZone,
      fallback: calendar.fallback,
      crops: catalog ?? calendar.crops,
      grnEnriched: catalog !== null,
    });
  });
}

// Joins the local calendar crops with GRN catalog entries by (case-insensitive)
// common name, attaching the GRN cropId/scientificName when a crop matches.
function enrichCrops(localCrops, catalogItems) {
  const byName = {};
  for (const item of catalogItems) {
    const name = (item.commonName ?? item.slug ?? "").toLowerCase();
    if (name) byName[name] = item;
  }
  return localCrops.map((c) => {
    const match = byName[c.crop.toLowerCase()];
    if (!match) return c;
    return {
      ...c,
      grnCropId: match.id ?? null,
      scientificName: match.scientificName ?? null,
    };
  });
}
