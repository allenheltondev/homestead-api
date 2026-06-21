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

// Confirmation line after POST /feed-purchases.
export function renderFeedConfirmation(purchase) {
  if (!purchase || typeof purchase !== "object") {
    return "Got it. I recorded your feed purchase.";
  }
  const quantity = purchase.quantity;
  const unit = purchase.unit;
  const type = purchase.type ?? "feed";
  const cost = purchase.cost;

  let line = "Got it. I recorded a feed purchase";
  if (quantity != null && unit) {
    line += ` of ${quantity} ${unit} of ${type}`;
  } else {
    line += ` of ${type}`;
  }
  if (cost != null) {
    line += ` for ${speakMoney(cost)}`;
  }
  return `${line}.`;
}

export const __testables = { speakList, pluralize, speakMoney };
