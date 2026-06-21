// APL helpers for the Homestead skill. Each `add*Screen` function gates on the
// device's `Alexa.Presentation.APL` interface so the skill stays voice-only on
// headless devices (Echo Dot, phone) and adds a visual screen only where it's
// supported. The datasource builders are pure so they can be unit-tested
// without ask-sdk.
//
// This module is the UNION of the herd visuals (home / herd summary / herd
// count / confirmation) and the egg visuals (egg stats / egg cost).

import {
  herdScreenDocument,
  confirmationDocument,
  homeDocument,
  eggStatsDocument,
  eggCostDocument,
  feedInventoryDocument,
  COLORS,
} from "../apl/documents.mjs";

const APL_INTERFACE = "Alexa.Presentation.APL";

// True when the requesting device supports APL. Reads the supported-interfaces
// map off the request envelope, the same gate the rest of the skill uses.
export function supportsApl(handlerInput) {
  const interfaces =
    handlerInput?.requestEnvelope?.context?.System?.device
      ?.supportedInterfaces;
  return Boolean(interfaces && interfaces[APL_INTERFACE]);
}

// Adds a RenderDocument directive only on APL devices; returns the
// responseBuilder either way so callers can chain .speak().getResponse().
function render(handlerInput, token, document, datasources) {
  const rb = handlerInput.responseBuilder;
  if (!supportsApl(handlerInput)) return rb;
  return rb.addDirective({
    type: "Alexa.Presentation.APL.RenderDocument",
    token,
    document,
    datasources,
  });
}

// ---------------------------------------------------------------------------
// Herd visuals (home / herd summary / herd count / confirmation)
// ---------------------------------------------------------------------------

function capitalize(value) {
  const text = String(value ?? "");
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function money(amount) {
  const value = Number(amount) || 0;
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function friendlyDate(now) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}

// GET /stats/summary -> herd screen datasource.
export function buildSummaryData(summary, now = new Date()) {
  const herd = summary?.herd ?? {};
  const bySpecies = Array.isArray(herd.bySpecies) ? herd.bySpecies : [];
  const total = herd.totalAnimals ?? 0;
  const births = summary?.births?.thisMonth ?? 0;
  const deaths = summary?.deaths?.thisMonth ?? 0;
  const feed = summary?.feed?.thisMonthSpend ?? 0;
  return {
    title: "Herd Summary",
    subtitle: friendlyDate(now),
    total: plural(total, "animal"),
    species: bySpecies.map((s) => ({
      name: capitalize(s.species ?? "animal"),
      count: String(s.active ?? s.total ?? 0),
    })),
    footer: [
      plural(births, "birth"),
      plural(deaths, "death"),
      `${money(feed)} feed`,
    ],
  };
}

// GET /stats/herd -> herd screen datasource.
export function buildHerdData(herd, now = new Date()) {
  const total = herd?.total ?? 0;
  const active = herd?.byStatus?.active ?? 0;
  const entries = Object.entries(herd?.bySpecies ?? {});
  return {
    title: "Herd Count",
    subtitle: friendlyDate(now),
    total: plural(total, "animal"),
    species: entries.map(([name, s]) => ({
      name: capitalize(name),
      count: String(s?.total ?? 0),
    })),
    footer: [`${active} active`, `${entries.length} species`, ""],
  };
}

export function buildConfirmationData(title, message) {
  return { title, message: message ?? "" };
}

export function addHomeScreen(handlerInput) {
  return render(handlerInput, "home", homeDocument, {
    homestead: {
      title: "Homestead",
      subtitle: "Your herd at a glance",
      hints: [
        "“Ask Homestead for my herd summary”",
        "“How many animals do I have?”",
        "“Record a birth”  ·  “Record a feed purchase”",
      ],
    },
  });
}

export function addHerdSummaryScreen(handlerInput, summary, now) {
  return render(handlerInput, "herd-summary", herdScreenDocument, {
    homestead: buildSummaryData(summary, now),
  });
}

export function addHerdCountScreen(handlerInput, herd, now) {
  return render(handlerInput, "herd-count", herdScreenDocument, {
    homestead: buildHerdData(herd, now),
  });
}

export function addConfirmationScreen(handlerInput, title, message) {
  return render(handlerInput, "confirmation", confirmationDocument, {
    confirmation: buildConfirmationData(title, message),
  });
}

// ---------------------------------------------------------------------------
// Egg visuals (egg stats / egg cost)
// ---------------------------------------------------------------------------

// Pure datasource builder for the egg-stats screen.
export function buildEggStatsDatasource(stats) {
  const count = stats?.count ?? 0;
  const dozens = stats?.dozens ?? Math.floor(count / 12);
  const perDay =
    stats?.perDay != null && Number.isFinite(Number(stats.perDay))
      ? Math.round(Number(stats.perDay))
      : 0;
  return {
    data: {
      title: "Egg Collection",
      subtitle: stats?.periodLabel ?? "this month",
      stats: [
        { label: "eggs", value: String(count) },
        { label: "dozen", value: String(dozens) },
        { label: "per day", value: String(perDay) },
      ],
    },
  };
}

// Pure datasource builder for the egg-cost screen, including the cheaper /
// more-expensive badge.
export function buildEggCostDatasource(cost) {
  const perDozen = Number(cost?.costPerDozen);
  const storePrice = Number(cost?.storePricePerDozen);
  const fmt = (v) =>
    Number.isFinite(v) ? (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`) : "—";

  let badge = { text: "no comparison", color: COLORS.surface };
  if (Number.isFinite(perDozen) && Number.isFinite(storePrice)) {
    if (perDozen < storePrice) {
      badge = { text: "Cheaper than store", color: COLORS.cheaper };
    } else if (perDozen > storePrice) {
      badge = { text: "Pricier than store", color: COLORS.expensive };
    } else {
      badge = { text: "Same as store", color: COLORS.surface };
    }
  }

  return {
    data: {
      title: "Egg Cost",
      subtitle: cost?.periodLabel ?? "this month",
      stats: [
        { label: "your cost / dozen", value: fmt(perDozen) },
        { label: "store / dozen", value: fmt(storePrice) },
      ],
      badge,
    },
  };
}

// Attaches the egg-stats screen to the response (when supported).
export function addEggStatsScreen(handlerInput, stats) {
  return render(
    handlerInput,
    "eggStatsToken",
    eggStatsDocument,
    buildEggStatsDatasource(stats),
  );
}

// Attaches the egg-cost screen to the response (when supported).
export function addEggCostScreen(handlerInput, cost) {
  return render(
    handlerInput,
    "eggCostToken",
    eggCostDocument,
    buildEggCostDatasource(cost),
  );
}

// ---------------------------------------------------------------------------
// Feed inventory visual
// ---------------------------------------------------------------------------

// Pure datasource builder for the feed-inventory screen. Accepts either a
// single-type inventory payload (top-level onHandLbs/daysRemaining/runOutDate)
// or a rollup with an `items` array, and normalizes both into a `feeds` list of
// { name, onHand, percent, daysRemaining } rows. Bar percents are scaled
// relative to the largest on-hand amount so the fullest bar fills the row.
export function buildFeedInventoryDatasource(inventory) {
  const raw = Array.isArray(inventory?.items)
    ? inventory.items
    : inventory
      ? [inventory]
      : [];

  const onHandOf = (e) => Number(e?.onHandLbs ?? e?.lbs ?? 0) || 0;
  const max = raw.reduce((m, e) => Math.max(m, onHandOf(e)), 0);

  const feeds = raw.map((e) => {
    const onHand = onHandOf(e);
    const percent = max > 0 ? Math.round((onHand / max) * 100) : 0;
    const days = e?.daysRemaining;
    const daysText =
      days != null && Number.isFinite(Number(days))
        ? `${plural(Math.round(Number(days)), "day")} left`
        : "no usage data";
    return {
      name: capitalize(e?.feedType ?? "feed"),
      onHand: `${onHand} lb`,
      percent,
      daysRemaining: daysText,
    };
  });

  return {
    data: {
      title: "Feed Inventory",
      subtitle: friendlyDate(),
      feeds,
    },
  };
}

// Attaches the feed-inventory screen to the response (when supported).
export function addFeedInventoryScreen(handlerInput, inventory) {
  return render(
    handlerInput,
    "feedInventoryToken",
    feedInventoryDocument,
    buildFeedInventoryDatasource(inventory),
  );
}
