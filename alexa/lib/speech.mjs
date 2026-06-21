// Pure functions that turn API payloads into spoken English. Kept free of
// the ask-sdk so they're trivially unit-testable: each takes a plain object
// (the API response shape from api/domain/stats.mjs) and returns a string.

// Joins a list into natural speech: ["a"] -> "a", ["a","b"] -> "a and b",
// ["a","b","c"] -> "a, b, and c".
function speakList(parts) {
  const items = parts.filter(Boolean);
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// Pluralizes a noun against a count: pluralize(1,"animal") -> "1 animal",
// pluralize(2,"animal") -> "2 animals".
function pluralize(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// Formats a money amount for speech. Whole dollars drop the cents.
function speakMoney(amount) {
  const value = Number(amount) || 0;
  if (Number.isInteger(value)) return pluralize(value, "dollar");
  return `${value.toFixed(2)} dollars`;
}

// Renders GET /stats/summary into a single spoken paragraph covering herd by
// species, births/deaths this month, and feed spend this month.
export function renderSummary(summary) {
  if (!summary || typeof summary !== "object") {
    return "I couldn't read your homestead summary right now.";
  }

  const herd = summary.herd ?? {};
  const bySpecies = Array.isArray(herd.bySpecies) ? herd.bySpecies : [];
  const births = summary.births ?? {};
  const deaths = summary.deaths ?? {};
  const feed = summary.feed ?? {};

  const sentences = [];

  const totalAnimals = herd.totalAnimals ?? 0;
  if (totalAnimals === 0) {
    sentences.push("You don't have any animals recorded yet.");
  } else {
    const speciesParts = bySpecies.map((s) =>
      pluralize(s.active ?? s.total ?? 0, s.species ?? "animal"),
    );
    const speciesPhrase = speciesParts.length
      ? `: ${speakList(speciesParts)}`
      : "";
    sentences.push(
      `You have ${pluralize(totalAnimals, "animal")}${speciesPhrase}.`,
    );
  }

  const birthsMonth = births.thisMonth ?? 0;
  const deathsMonth = deaths.thisMonth ?? 0;
  sentences.push(
    `This month there ${birthsMonth === 1 ? "was" : "were"} ${pluralize(
      birthsMonth,
      "birth",
    )} and ${pluralize(deathsMonth, "death")}.`,
  );

  const feedSpend = feed.thisMonthSpend ?? 0;
  sentences.push(`You've spent ${speakMoney(feedSpend)} on feed this month.`);

  return sentences.join(" ");
}

// Renders GET /stats/herd into a spoken count line.
export function renderHerdCount(herd) {
  if (!herd || typeof herd !== "object") {
    return "I couldn't read your herd count right now.";
  }
  const total = herd.total ?? 0;
  const active = herd.byStatus?.active ?? 0;
  if (total === 0) return "You don't have any animals recorded yet.";

  const bySpecies = herd.bySpecies ?? {};
  const speciesParts = Object.entries(bySpecies).map(([species, s]) =>
    pluralize(s.total ?? 0, species),
  );
  const speciesPhrase = speciesParts.length
    ? `: ${speakList(speciesParts)}`
    : "";
  return `You have ${pluralize(total, "animal")}${speciesPhrase}. ${pluralize(
    active,
    "animal",
  )} ${active === 1 ? "is" : "are"} active.`;
}

// Confirmation line after POST /births.
export function renderBirthConfirmation(result) {
  const animal = result?.animal ?? {};
  const species = animal.species ?? "animal";
  return `Got it. I recorded the birth of a ${species}.`;
}

// Spells out a per-bag weight as an adjective phrase ("fifty-pound"). Falls
// back to the numeric form for anything we don't have a word for.
const WEIGHT_WORDS = {
  10: "ten",
  20: "twenty",
  25: "twenty-five",
  40: "forty",
  50: "fifty",
  75: "seventy-five",
  80: "eighty",
  100: "one hundred",
};

function weightAdjective(lbs) {
  const word = WEIGHT_WORDS[lbs];
  return word ? `${word}-pound` : `${lbs}-pound`;
}

// Confirmation line after POST /feed-purchases. Reads back the bag count, the
// per-bag weight, and the computed total ("Recorded 4 fifty-pound bags of
// chicken feed, 200 pounds.").
export function renderFeedConfirmation(purchase) {
  if (!purchase || typeof purchase !== "object") {
    return "Got it. I recorded your feed purchase.";
  }
  const bags = purchase.bags;
  const bagWeightLbs = purchase.bagWeightLbs;
  const feedType = purchase.feedType ?? "feed";
  const cost = purchase.cost;
  const totalLbs =
    purchase.totalLbs ??
    (bags != null && bagWeightLbs != null ? bags * bagWeightLbs : undefined);

  let line = "Got it. ";
  if (bags != null && bagWeightLbs != null) {
    line += `Recorded ${pluralize(bags, `${weightAdjective(bagWeightLbs)} bag`)} of ${feedType} feed`;
    if (totalLbs != null) line += `, ${pluralize(totalLbs, "pound")}`;
  } else {
    line += `Recorded a ${feedType} feed purchase`;
  }
  if (cost != null) {
    line += `, ${speakMoney(cost)}`;
  }
  return `${line}.`;
}

// Confirmation line after POST /egg-collections.
export function renderEggLogged(result) {
  if (!result || typeof result !== "object") {
    return "Got it. I logged your egg collection.";
  }
  const count = result.count ?? 0;
  return `Got it. I logged ${pluralize(count, "egg")}.`;
}

// Pluralizes "dozen" (1 dozen / 2 dozen) for speech.
function speakDozens(dozens) {
  return `${dozens} dozen`;
}

// Renders GET /stats/eggs: total collected, dozens, and a rough per-day rate
// ("You collected 84 eggs this month, 7 dozen, about 3 a day.").
export function renderEggStats(stats) {
  if (!stats || typeof stats !== "object") {
    return "I couldn't read your egg stats right now.";
  }
  const count = stats.count ?? 0;
  const periodLabel = stats.periodLabel ?? "this month";
  if (count === 0) {
    return `You haven't collected any eggs ${periodLabel}.`;
  }

  const parts = [`You collected ${pluralize(count, "egg")} ${periodLabel}`];
  const dozens = stats.dozens ?? Math.floor(count / 12);
  if (dozens >= 1) parts.push(speakDozens(dozens));

  const perDay = stats.perDay;
  if (perDay != null && Number.isFinite(Number(perDay))) {
    const rounded = Math.round(Number(perDay));
    parts.push(`about ${pluralize(rounded, "egg")} a day`);
  }
  return `${parts.join(", ")}.`;
}

// Renders GET /stats/egg-cost: cost per dozen with a break-even comparison to
// the store price ("Your eggs cost about $2.10 a dozen — cheaper than the $4
// store price.").
export function renderEggCost(cost) {
  if (!cost || typeof cost !== "object") {
    return "I couldn't read your egg cost right now.";
  }
  const perDozen = Number(cost.costPerDozen);
  if (!Number.isFinite(perDozen)) {
    return "I don't have enough data to estimate your egg cost yet.";
  }
  const storePrice = Number(cost.storePricePerDozen);

  let line = `Your eggs cost about ${speakDollars(perDozen)} a dozen`;
  if (Number.isFinite(storePrice)) {
    if (perDozen < storePrice) {
      line += ` — cheaper than the ${speakDollars(storePrice)} store price`;
    } else if (perDozen > storePrice) {
      line += ` — more expensive than the ${speakDollars(storePrice)} store price`;
    } else {
      line += ` — the same as the ${speakDollars(storePrice)} store price`;
    }
  }
  return `${line}.`;
}

// Confirmation line after POST /feed-consumption. Reads back the amount fed
// and the feed type ("Got it. I logged 25 pounds of chicken feed.").
export function renderFeedUsageLogged(result) {
  if (!result || typeof result !== "object") {
    return "Got it. I logged that feed usage.";
  }
  const lbs = result.lbs;
  const feedType = result.feedType ?? "feed";
  if (lbs == null || !Number.isFinite(Number(lbs))) {
    return `Got it. I logged some ${feedType} feed.`;
  }
  return `Got it. I logged ${pluralize(Number(lbs), "pound")} of ${feedType} feed.`;
}

// Speaks a projected run-out date as a natural phrase. Accepts an ISO date and
// returns "around Friday, July 3rd" style text; falls back to the raw value.
function speakRunOutDate(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(`${value.trim()}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value.trim();
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

// Renders GET /stats/feed-inventory into spoken English: on-hand pounds, days
// remaining at the current burn rate, and a projected run-out date. Handles a
// single-type query and a whole-homestead rollup ("You have 120 pounds of
// chicken feed left, about 12 days, running out around Friday, July 3rd.").
export function renderFeedInventory(inventory) {
  if (!inventory || typeof inventory !== "object") {
    return "I couldn't read your feed inventory right now.";
  }

  // Single feed type: top-level onHandLbs/daysRemaining/runOutDate (+ feedType).
  const items = Array.isArray(inventory.items) ? inventory.items : null;

  const describe = (entry, label) => {
    const onHand = Number(entry.onHandLbs ?? entry.lbs ?? 0);
    const feedLabel = label ? `${label} feed` : "feed";
    if (!(onHand > 0)) {
      return `You're out of ${feedLabel}.`;
    }
    const parts = [`You have ${pluralize(onHand, "pound")} of ${feedLabel} left`];
    const days = entry.daysRemaining;
    if (days != null && Number.isFinite(Number(days))) {
      parts.push(`about ${pluralize(Math.round(Number(days)), "day")}`);
    }
    const runOut = speakRunOutDate(entry.runOutDate);
    if (runOut) parts.push(`running out around ${runOut}`);
    return `${parts.join(", ")}.`;
  };

  if (items) {
    if (items.length === 0) {
      return "You don't have any feed on hand right now.";
    }
    return items.map((it) => describe(it, it.feedType)).join(" ");
  }

  return describe(inventory, inventory.feedType);
}

// Formats a dollar amount with the "$" sign and cents when present ("$2.10",
// "$4"). Used by the egg-cost comparison where the symbol reads naturally.
function speakDollars(amount) {
  const value = Number(amount) || 0;
  if (Number.isInteger(value)) return `$${value}`;
  return `$${value.toFixed(2)}`;
}

export const __testables = {
  speakList,
  pluralize,
  speakMoney,
  speakDollars,
  weightAdjective,
};
