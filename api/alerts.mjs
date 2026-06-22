import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { feedInventory } from "./domain/stats.mjs";
import { listCareTasksDue } from "./domain/careTask.mjs";
import { listBreedingsDue } from "./domain/breeding.mjs";
import { listIncubationBatches } from "./domain/incubation.mjs";
import { isGrnConfigured, listMyListings } from "./lib/grn.mjs";
import { publishEvent } from "./services/events.mjs";
import { logger } from "./services/logger.mjs";

// Scheduled homestead alerts function (own esbuild entry point; see
// template.yaml AlertsFunction). On its daily schedule it composes an alert
// payload -- low feed, care tasks due soon, upcoming hatches + breedings, and
// (when coordinates are configured) frost/heat weather via open-meteo -- then
// ALWAYS publishes a HomesteadAlert domain event. When DIGEST_SENDER +
// DIGEST_RECIPIENT are configured it also emails the alerts via SES (best
// effort, wrapped in try/catch so a delivery failure never fails the run).
//
// open-meteo needs internet egress; the function runs on default Lambda
// networking (no VPC) so it has outbound access. The weather block is skipped
// entirely when HOMESTEAD_LATITUDE / HOMESTEAD_LONGITUDE are unset.

const ses = new SESClient();

// Care tasks / hatches / breedings due within this many days are alert-worthy.
const CARE_DUE_DAYS = 3;
const HATCH_WINDOW_DAYS = 7;
const BREEDING_WINDOW_DAYS = 7;

// Frost below this temperature (C); heat above this temperature (C).
const FROST_C = 2;
const HEAT_C = 32;

function lowFeedDays() {
  const parsed = parseInt(process.env.LOW_FEED_ALERT_DAYS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}

// Feed types with daysRemaining below the threshold (run-out risk).
async function lowFeedAlerts(now) {
  const inventory = await feedInventory(now);
  const threshold = lowFeedDays();
  return inventory.feedTypes
    .filter((f) => f.daysRemaining !== null && f.daysRemaining < threshold)
    .map((f) => ({
      feedType: f.feedType,
      onHandLbs: f.onHandLbs,
      daysRemaining: f.daysRemaining,
      projectedRunOutDate: f.projectedRunOutDate,
    }));
}

// Incubation batches whose expectedHatchAt falls within the hatch window and
// that are still incubating. Filtered in code from the collection listing.
async function upcomingHatches(now) {
  const batches = await listIncubationBatches();
  const end = new Date(now.getTime() + HATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();
  return batches
    .filter((b) => b.status === "incubating")
    .filter((b) => typeof b.expectedHatchAt === "string" && b.expectedHatchAt <= end)
    .map((b) => ({
      id: b.id,
      species: b.species,
      count: b.count,
      expectedHatchAt: b.expectedHatchAt,
      overdue: b.expectedHatchAt < nowIso,
    }));
}

// Fetches current-day min/max temperature from open-meteo and returns frost /
// heat flags. Returns null when coordinates are unset or the call fails (the
// alert run never depends on weather being reachable).
async function weatherAlert(now) {
  const lat = process.env.HOMESTEAD_LATITUDE;
  const lon = process.env.HOMESTEAD_LONGITUDE;
  if (!lat || !lon) return null;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}`
      + `&longitude=${encodeURIComponent(lon)}`
      + "&daily=temperature_2m_min,temperature_2m_max&forecast_days=1&timezone=UTC";
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn("weather fetch non-ok", { status: res.status });
      return null;
    }
    const data = await res.json();
    const min = data?.daily?.temperature_2m_min?.[0];
    const max = data?.daily?.temperature_2m_max?.[0];
    if (typeof min !== "number" && typeof max !== "number") return null;

    return {
      date: data?.daily?.time?.[0] ?? now.toISOString().slice(0, 10),
      minC: typeof min === "number" ? min : null,
      maxC: typeof max === "number" ? max : null,
      frost: typeof min === "number" && min < FROST_C,
      heat: typeof max === "number" && max > HEAT_C,
    };
  } catch (err) {
    logger.warn("weather fetch failed", { error: err?.message });
    return null;
  }
}

// Composes the full alert payload + human-readable lines.
export async function composeAlerts(now = new Date()) {
  const [lowFeed, careTasks, breedings, hatches, weather] = await Promise.all([
    lowFeedAlerts(now),
    listCareTasksDue(CARE_DUE_DAYS, now),
    listBreedingsDue(BREEDING_WINDOW_DAYS, now),
    upcomingHatches(now),
    weatherAlert(now),
  ]);

  const lines = [];
  for (const f of lowFeed) {
    lines.push(
      `Low feed: ${f.feedType} ~${Math.round(f.daysRemaining)} days remaining`
      + (f.projectedRunOutDate ? ` (runs out ${f.projectedRunOutDate})` : ""),
    );
  }
  for (const t of careTasks) {
    lines.push(`Care task due: ${t.title} (due ${t.nextDueAt?.slice(0, 10) ?? "soon"})`);
  }
  for (const h of hatches) {
    lines.push(
      `${h.overdue ? "Hatch overdue" : "Hatch upcoming"}: ${h.count} ${h.species} `
      + `eggs (${h.expectedHatchAt.slice(0, 10)})`,
    );
  }
  for (const b of breedings) {
    lines.push(`Breeding due: ${b.species} dam ${b.damId} (${b.expectedDueAt?.slice(0, 10)})`);
  }
  if (weather?.frost) lines.push(`Frost warning: low ${weather.minC}C`);
  if (weather?.heat) lines.push(`Heat warning: high ${weather.maxC}C`);

  const breedingSummaries = breedings.map((b) => ({
    id: b.id,
    species: b.species,
    damId: b.damId,
    expectedDueAt: b.expectedDueAt,
  }));
  const careSummaries = careTasks.map((t) => ({
    id: t.id,
    title: t.title,
    category: t.category,
    nextDueAt: t.nextDueAt,
  }));

  return {
    asOf: now.toISOString(),
    lowFeed,
    careTasksDue: careSummaries,
    upcomingHatches: hatches,
    upcomingBreedings: breedingSummaries,
    weather,
    alertCount: lines.length,
    lines,
  };
}

// Best-effort GRN claim-status sync. There is no local harvest/listing store
// anymore -- harvests + listings live entirely in GRN -- so this simply fetches
// the homestead's own claimed GRN listings (GET /my/listings?status=claimed),
// emits a GrnListingClaimed event per claimed listing, and returns a
// human-readable alert line for each. EVERYTHING here is wrapped so GRN being
// down/unconfigured never breaks the alert run -- on any failure it returns [].
export async function syncGrnClaimStatus() {
  if (!isGrnConfigured()) return [];

  try {
    const myListings = await listMyListings({ status: "claimed", limit: 100 });
    const items = Array.isArray(myListings) ? myListings : myListings?.items;
    if (!Array.isArray(items) || items.length === 0) return [];

    const lines = [];
    for (const listing of items) {
      if (!listing?.id || listing.status !== "claimed") continue;

      const label = listing.title
        ?? listing.cropName
        ?? listing.crop_name
        ?? listing.id;
      lines.push(`GRN listing claimed: ${label}`);
      await publishEvent("GrnListingClaimed", {
        grnListingId: listing.id,
        title: listing.title ?? null,
      });
    }
    return lines;
  } catch (err) {
    // GRN unreachable/unauthorized/unconfigured -> never fail the alert run.
    logger.warn("GRN claim-status sync skipped", { error: err?.message });
    return [];
  }
}

function renderEmail(alerts) {
  const text = alerts.lines.length > 0
    ? alerts.lines.join("\n")
    : "No homestead alerts today.";
  const items = alerts.lines.length > 0
    ? alerts.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")
    : "<li>No homestead alerts today.</li>";
  const html = `<html><body><h2>Homestead Alerts</h2><ul>${items}</ul></body></html>`;
  return { text, html };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendAlertEmail(alerts, sender, recipient) {
  const { text, html } = renderEmail(alerts);
  await ses.send(new SendEmailCommand({
    Source: sender,
    Destination: { ToAddresses: [recipient] },
    Message: {
      Subject: { Data: "Homestead Alerts" },
      Body: {
        Text: { Data: text },
        Html: { Data: html },
      },
    },
  }));
}

export const handler = async () => {
  const alerts = await composeAlerts();

  // Best-effort GRN claim-status sync. Appends a line per newly claimed/expired
  // listing (and emits GrnListingClaimed for new claims). Wrapped so GRN being
  // down/unconfigured never breaks the alert run.
  const grnLines = await syncGrnClaimStatus();
  if (grnLines.length > 0) {
    alerts.lines.push(...grnLines);
    alerts.alertCount = alerts.lines.length;
  }

  // Always publish the domain event first so downstream consumers see the
  // alerts regardless of whether email delivery is configured / succeeds.
  await publishEvent("HomesteadAlert", alerts);

  const sender = process.env.DIGEST_SENDER;
  const recipient = process.env.DIGEST_RECIPIENT;

  if (sender && recipient) {
    try {
      await sendAlertEmail(alerts, sender, recipient);
      logger.info("alert email sent", { recipient, alertCount: alerts.alertCount });
    } catch (err) {
      // Never fail the schedule on an email error -- the event is already out.
      logger.error("alert email failed", { error: err?.message });
    }
  } else {
    logger.info("alert email skipped (DIGEST_SENDER/DIGEST_RECIPIENT not set)", {
      alertCount: alerts.alertCount,
    });
  }

  return alerts;
};
