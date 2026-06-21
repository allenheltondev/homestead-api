// Maps Alexa intent slots into the request bodies the Homestead API expects.
// Kept pure and ask-sdk-free so the mapping is unit-testable in isolation.
// Each builder returns { ok: true, fields } or { ok: false, reprompt } so the
// handler can either call the API or ask the user for a missing slot.

// Reads a resolved/interpreted slot value off an intent. Alexa puts the spoken
// value on slot.value; entity-resolution canonical values (if any) live under
// resolutions. We prefer the resolved canonical value, falling back to the raw
// spoken value.
export function slotValue(intent, name) {
  const slot = intent?.slots?.[name];
  if (!slot) return undefined;
  const resolved =
    slot.resolutions?.resolutionsPerAuthority?.[0]?.values?.[0]?.value?.name;
  return resolved ?? slot.value ?? undefined;
}

// Units the API accepts (api/validation/feed.mjs). Spoken synonyms map onto
// the canonical unit token.
const UNIT_SYNONYMS = {
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  kg: "kg",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
  ton: "ton",
  tons: "ton",
  bag: "bag",
  bags: "bag",
  bale: "bale",
  bales: "bale",
  flake: "flake",
  flakes: "flake",
};

function normalizeUnit(raw) {
  if (typeof raw !== "string") return undefined;
  return UNIT_SYNONYMS[raw.trim().toLowerCase()];
}

// Spoken-quantity words Alexa may surface as a literal string rather than a
// resolved AMAZON.NUMBER (e.g. "a dozen eggs"). Map them to integers.
const WORD_NUMBERS = {
  "a dozen": 12,
  dozen: 12,
  "half dozen": 6,
  "half a dozen": 6,
  "a half dozen": 6,
  "two dozen": 24,
  "a couple": 2,
  couple: 2,
  "a few": 3,
  none: 0,
};

// Parses a slot value into a number. Accepts numeric strings and the spoken
// quantity words above ("a dozen" -> 12). Returns undefined when it can't.
function parseCount(raw) {
  if (raw == null) return undefined;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  if (typeof raw === "string") {
    const key = raw.trim().toLowerCase();
    if (key in WORD_NUMBERS) return WORD_NUMBERS[key];
  }
  return undefined;
}

// Returns a trimmed slot string when present and non-empty, else undefined.
function textSlot(intent, name) {
  const raw = slotValue(intent, name);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return undefined;
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

// Builds the POST /feed-purchases body for the dialog-delegated
// LogFeedPurchaseIntent. We pass bags + per-bag weight through verbatim and
// let the server compute the total; nothing is computed here. The dialog model
// guarantees the required slots are filled by the time COMPLETED fires, so
// these builders read what's present and forward it.
export function buildFeedFields(intent) {
  const bags = parseCount(slotValue(intent, "bags"));
  const bagWeightLbs = parseCount(slotValue(intent, "bagWeight"));
  const feedType = textSlot(intent, "feedType");

  const fields = {};
  if (Number.isFinite(bags)) fields.bags = bags;
  if (Number.isFinite(bagWeightLbs)) fields.bagWeightLbs = bagWeightLbs;
  if (feedType) fields.feedType = feedType;

  const cost = parseCount(slotValue(intent, "cost"));
  if (Number.isFinite(cost)) fields.cost = cost;

  const date = slotValue(intent, "date");
  if (isIsoDate(date)) fields.date = date.trim();

  return fields;
}

// Builds the POST /egg-collections body for LogEggCollectionIntent. "a dozen"
// maps to 12 via parseCount.
export function buildEggFields(intent) {
  const count = parseCount(slotValue(intent, "count"));
  const fields = {};
  if (Number.isFinite(count)) fields.count = count;

  const date = slotValue(intent, "date");
  if (isIsoDate(date)) fields.date = date.trim();

  const coop = textSlot(intent, "coop");
  if (coop) fields.coop = coop;

  return fields;
}

// Builds the POST /births body for the dialog-delegated RecordBirthIntent.
export function buildBirthFields(intent) {
  const species = textSlot(intent, "species");
  const fields = {};
  if (species) fields.species = species;

  const count = parseCount(slotValue(intent, "count"));
  if (Number.isFinite(count)) fields.count = count;

  const dam = textSlot(intent, "dam");
  if (dam) fields.dam = dam;

  const sire = textSlot(intent, "sire");
  if (sire) fields.sire = sire;

  const date = slotValue(intent, "date");
  if (isIsoDate(date)) fields.date = date.trim();

  return fields;
}

// Builds the POST /deaths body for RecordDeathIntent.
export function buildDeathFields(intent) {
  const animalRef = textSlot(intent, "animalRef");
  const fields = {};
  if (animalRef) fields.animalRef = animalRef;

  const cause = textSlot(intent, "cause");
  if (cause) fields.cause = cause;

  const date = slotValue(intent, "date");
  if (isIsoDate(date)) fields.date = date.trim();

  return fields;
}

// Builds the POST /moves body for MoveAnimalsIntent.
export function buildMoveFields(intent) {
  const group = textSlot(intent, "group");
  const pasture = textSlot(intent, "pasture");
  const fields = {};
  if (group) fields.group = group;
  if (pasture) fields.pasture = pasture;

  const date = slotValue(intent, "date");
  if (isIsoDate(date)) fields.date = date.trim();

  return fields;
}

// Reads an optional free-text period slot ("this month", "this week") used by
// the read-only egg stats/cost intents.
export function buildPeriodQuery(intent) {
  const period = textSlot(intent, "period");
  return period ? { period } : {};
}

export const __testables = { normalizeUnit, parseCount };
