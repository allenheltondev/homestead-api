import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { publishEvent } from "../services/events.mjs";
import { ConflictError } from "../services/errors.mjs";
import {
  validateHarvestLogCreate,
  validateHarvestLogQuery,
  formatHarvestLog,
} from "../validation/harvest.mjs";
import { buildListingPayload } from "../validation/grn.mjs";
import {
  createHarvestLog,
  deleteHarvestLog,
  getHarvestLog,
  listHarvestLogs,
  updateHarvestGrnFields,
} from "../domain/harvest.mjs";
import { createListing, expireListing } from "../lib/grn.mjs";

// Harvest-log routes. Handlers stay thin: validate -> domain -> format. The
// publish endpoints add the GRN two-way integration: publishing a surplus
// harvest as a GRN listing and retiring it. Keys + access patterns live in
// api/domain/harvest.mjs (month-partition fan-out + id pointer; no Scans).
export function registerHarvestRoutes(app) {
  // POST /harvest-logs — record a harvest and publish HarvestLogged.
  app.post("/harvest-logs", async ({ event }) => {
    const fields = validateHarvestLogCreate(parseBody(event));
    const item = await createHarvestLog(fields);

    await publishEvent("HarvestLogged", {
      id: item.id,
      cropName: item.cropName,
      variety: item.variety ?? null,
      quantity: item.quantity,
      unit: item.unit,
      harvestedAt: item.harvestedAt,
      surplus: item.surplus ?? false,
    });

    return jsonResponse(201, formatHarvestLog(item));
  });

  // GET /harvest-logs?from=&to= — date range (ISO date or YYYY-MM). Range ->
  // month-partition fan-out; no Scan.
  app.get("/harvest-logs", async ({ event }) => {
    const filters = validateHarvestLogQuery(event.queryStringParameters ?? {});
    const items = await listHarvestLogs(filters);
    return jsonResponse(200, { harvest_logs: items.map(formatHarvestLog) });
  });

  // GET /harvest-logs/{id} — single log (resolved via the id pointer).
  app.get("/harvest-logs/:id", async ({ params }) => {
    const item = await getHarvestLog(params.id);
    return jsonResponse(200, formatHarvestLog(item));
  });

  // DELETE /harvest-logs/{id} — cleanup. Resolves the base-table key via the
  // id pointer (see domain/harvest.mjs), so no Scan.
  app.delete("/harvest-logs/:id", async ({ params }) => {
    await deleteHarvestLog(params.id);
    return emptyResponse(204);
  });

  // POST /harvest-logs/{id}/publish — publish the harvest as a GRN listing.
  // Builds an UpsertListing from the harvest (+ the publish body's required
  // GRN cropId / availability window), POSTs it to GRN with the harvest id as
  // the Idempotency-Key, then stores grnListingId + grnStatus=active locally.
  app.post("/harvest-logs/:id/publish", async ({ event, params }) => {
    const harvest = await getHarvestLog(params.id);
    if (harvest.grnListingId) {
      throw new ConflictError("harvest is already published to the Good Roots Network");
    }

    const payload = buildListingPayload(harvest, parseBody(event));
    const correlationId = event?.requestContext?.requestId;
    const listing = await createListing(payload, { idempotencyKey: harvest.id, correlationId });

    const grnListingId = listing?.id ?? null;
    const grnStatus = listing?.status ?? "active";
    const updated = await updateHarvestGrnFields(harvest.id, { grnListingId, grnStatus });

    await publishEvent("GrnListingPublished", {
      id: harvest.id,
      grnListingId,
      grnStatus,
      cropName: harvest.cropName,
    });

    return jsonResponse(201, {
      harvest_log: formatHarvestLog(updated),
      listing,
    });
  });

  // DELETE /harvest-logs/{id}/publish — retire the GRN listing and clear the
  // local linkage fields.
  app.delete("/harvest-logs/:id/publish", async ({ event, params }) => {
    const harvest = await getHarvestLog(params.id);
    if (!harvest.grnListingId) {
      throw new ConflictError("harvest is not published to the Good Roots Network");
    }

    const correlationId = event?.requestContext?.requestId;
    // Expire the listing upstream (the contract has no DELETE; updateListing
    // flips status to expired -- see lib/grn.mjs). Best-effort: if it is
    // already gone upstream we still clear the local link below.
    await expireListing(harvest.grnListingId, buildRetirePayload(harvest), { correlationId });

    const updated = await updateHarvestGrnFields(harvest.id, {
      grnListingId: null,
      grnStatus: null,
    });

    await publishEvent("GrnListingRetired", {
      id: harvest.id,
      cropName: harvest.cropName,
    });

    return jsonResponse(200, { harvest_log: formatHarvestLog(updated) });
  });
}

// Minimal listing body for the retire (PUT) call. GRN's updateListing reuses
// UpsertListingRequest, so we resend the harvest-derived required fields with
// status flipped to expired (done in lib/grn.expireListing).
function buildRetirePayload(harvest) {
  return {
    quantityTotal: harvest.quantity,
    unit: harvest.unit,
  };
}
