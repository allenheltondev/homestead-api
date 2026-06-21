import {
  eggStats,
  feedStats,
  feedInventory,
  birthStats,
  deathStats,
  mortalitySummary,
} from "./stats.mjs";
import { yyyymm } from "../services/time.mjs";

// Weekly digest composition. Pure aggregation built entirely from the existing
// stats domain functions -- it issues no DynamoDB calls of its own, so unit
// tests exercise it by mocking those functions (or the shared `ddb` client the
// stats layer uses). `composeWeeklyDigest` returns a ready-to-render payload:
// a structured summary plus a `lines` array of human-readable strings the
// scheduled function turns into an email / event body.
//
// The reporting window is the trailing 7 days ending at `now` (inclusive).
// The underlying stats functions aggregate by month bucket, so the week's
// figures are computed over the month partition(s) the window touches --
// adequate for a personal-scale weekly snapshot.

// The list of YYYY-MM month buckets the trailing-7-day window touches (one or
// two). Used to scope the monthly stats aggregations.
function weekMonths(now) {
  const end = new Date(now);
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const startMonth = yyyymm(start);
  const endMonth = yyyymm(end);
  return startMonth === endMonth ? [startMonth] : [startMonth, endMonth];
}

// Formats a number to at most two decimals, dropping a trailing `.00`.
function fmt(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return Number(value.toFixed(2)).toString();
}

// Formats a dollar amount.
function money(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(2)}`;
}

export async function composeWeeklyDigest(now = new Date()) {
  const end = new Date(now);
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const months = weekMonths(end);
  const period = { from: start.toISOString(), to: end.toISOString() };

  const [eggs, feed, inventory, births, deaths, mortality] = await Promise.all([
    eggStats(months),
    feedStats(months),
    feedInventory(end),
    birthStats(months),
    deathStats(months),
    // Mortality summary scoped to the same window's months; the period label
    // is the from..to span.
    mortalitySummary(`${period.from}/${period.to}`, months),
  ]);

  const feedSpend = feed.totalCost;
  const feedOnHandLbs = inventory.totals.onHandLbs;
  const daysRemaining = inventory.totals.daysRemaining;

  const lines = [
    `Week of ${period.from.slice(0, 10)} to ${period.to.slice(0, 10)}`,
    `Eggs collected: ${eggs.totalEggs} (${fmt(eggs.dozens)} dozen)`,
    `Feed spend: ${money(feedSpend)}`,
    `Feed on hand: ${fmt(feedOnHandLbs)} lbs`
      + (daysRemaining === null ? "" : ` (~${fmt(daysRemaining)} days remaining)`),
    `Births: ${births.total}`,
    `Deaths: ${deaths.total}`
      + (mortality.topCause ? ` (top cause: ${mortality.topCause})` : ""),
    `Loss rate: ${fmt(mortality.lossRate * 100)}%`,
  ];

  return {
    period,
    eggs: { total: eggs.totalEggs, dozens: eggs.dozens },
    feedSpend,
    feedOnHandLbs,
    daysRemaining,
    births: births.total,
    deaths: deaths.total,
    mortality: { lossRate: mortality.lossRate, topCause: mortality.topCause },
    lines,
  };
}
