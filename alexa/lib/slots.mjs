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

// Approximate pound-equivalents for the non-pound units the feed-usage intent
// accepts. Used to normalize a spoken amount into pounds before posting.
const UNIT_TO_LBS = {
  lb: 1,
  kg: 2.20462,
  ton: 2000,
};

// Builds the POST /feed-consumption body for the dialog-delegated
// LogFeedUsageIntent. Converts the spoken amount + unit into pounds (defaulting
// to pounds when no unit is given) so the server always receives a `lbs` field,
// alongside the feed type and an optional date.
export function buildFeedUsageFields(intent) {
  const feedType = textSlot(intent, "feedType");
  const amount = parseCount(slotValue(intent, "amount"));
  const unit = normalizeUnit(slotValue(intent, "unit")) ?? "lb";

  const fields = {};
  if (feedType) fields.feedType = feedType;
  if (Number.isFinite(amount)) {
    const factor = UNIT_TO_LBS[unit] ?? 1;
    const lbs = amount * factor;
    // Keep round numbers clean while still allowing fractional kg/ton results.
    fields.lbs = Number.isInteger(lbs) ? lbs : Math.round(lbs * 100) / 100;
  }

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

// Builds the read-only egg-cost query: an optional `period` plus an optional
// `flock` (coop) filter. Either, both, or neither may be present.
export function buildEggCostQuery(intent) {
  const query = buildPeriodQuery(intent);
  const flock = textSlot(intent, "flock");
  if (flock) query.flock = flock;
  return query;
}

// Builds the POST /health-expenses body for the dialog-delegated
// RecordHealthExpenseIntent. Required slots (category + cost) are guaranteed by
// the dialog model on COMPLETED; animalRef and date are optional.
export function buildHealthExpenseFields(intent) {
  const category = textSlot(intent, "category");
  const fields = {};
  if (category) fields.category = category;

  const cost = parseCount(slotValue(intent, "cost"));
  if (Number.isFinite(cost)) fields.cost = cost;

  const animalRef = textSlot(intent, "animalRef");
  if (animalRef) fields.animalRef = animalRef;

  const date = slotValue(intent, "date");
  if (isIsoDate(date)) fields.date = date.trim();

  return fields;
}

// Volume units the milk API accepts. Spoken synonyms map onto the canonical
// token. Kept separate from feed UNIT_SYNONYMS since milk is liquid volume.
const MILK_UNIT_SYNONYMS = {
  gallon: "gal",
  gallons: "gal",
  gal: "gal",
  quart: "qt",
  quarts: "qt",
  qt: "qt",
  pint: "pt",
  pints: "pt",
  pt: "pt",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  l: "l",
  ounce: "oz",
  ounces: "oz",
  oz: "oz",
  cup: "cup",
  cups: "cup",
};

function normalizeMilkUnit(raw) {
  if (typeof raw !== "string") return undefined;
  return MILK_UNIT_SYNONYMS[raw.trim().toLowerCase()];
}

// Builds the POST /milk-logs body for the dialog-delegated LogMilkIntent.
// Volume is the required slot (guaranteed by the dialog on COMPLETED); the
// unit defaults to gallons, and the animal and date are optional.
export function buildMilkFields(intent) {
  const volume = parseCount(slotValue(intent, "volume"));
  const unit = normalizeMilkUnit(slotValue(intent, "unit")) ?? "gal";

  const fields = {};
  if (Number.isFinite(volume)) {
    fields.volume = volume;
    fields.unit = unit;
  }

  const animal = textSlot(intent, "animal");
  if (animal) fields.animal = animal;

  const date = slotValue(intent, "date");
  if (isIsoDate(date)) fields.date = date.trim();

  return fields;
}

// Reads an optional integer "within days" slot used by the care-due and
// upcoming-due read intents. Returns the number when a sane positive integer
// was spoken, else undefined so the API applies its default window.
export function buildWithinDays(intent) {
  const raw = parseCount(slotValue(intent, "withinDays"));
  if (Number.isFinite(raw) && raw > 0) return Math.round(raw);
  return undefined;
}

// Reads the care task the user named for CompleteCareTaskIntent. Returns the
// trimmed task name/id string, or undefined when no task slot was filled.
export function buildCareTaskRef(intent) {
  return textSlot(intent, "task");
}

// --- Garden pillar: harvest logging --------------------------------------

// Produce/quantity units the harvest API accepts. Spoken synonyms map onto the
// canonical token. Garden harvests are weighed (pounds/ounces/kilograms) or
// counted by piece/bunch/basket, so this is its own table separate from feed
// and milk units.
const HARVEST_UNIT_SYNONYMS = {
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  kg: "kg",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
  gram: "g",
  grams: "g",
  g: "g",
  piece: "piece",
  pieces: "piece",
  each: "piece",
  count: "piece",
  bunch: "bunch",
  bunches: "bunch",
  basket: "basket",
  baskets: "basket",
  bushel: "bushel",
  bushels: "bushel",
  pint: "pint",
  pints: "pint",
  quart: "quart",
  quarts: "quart",
};

function normalizeHarvestUnit(raw) {
  if (typeof raw !== "string") return undefined;
  return HARVEST_UNIT_SYNONYMS[raw.trim().toLowerCase()];
}

// Builds the spoken harvest details for the dialog-delegated LogHarvestIntent.
// Required slots (crop + quantity) are guaranteed by the dialog model on
// COMPLETED. Harvests now record to the Good Roots Network per-crop, so the
// `crop` here is the spoken NAME the handler resolves to a cropLibraryId; the
// remaining fields make up the GRN harvest body ({ amount, unit, harvestedOn }).
// The unit defaults to pounds and the date is optional.
export function buildHarvestFields(intent) {
  const crop = textSlot(intent, "crop");
  const amount = parseCount(slotValue(intent, "quantity"));
  const unit = normalizeHarvestUnit(slotValue(intent, "unit")) ?? "lb";

  const fields = {};
  if (crop) fields.crop = crop;
  if (Number.isFinite(amount)) {
    fields.amount = amount;
    fields.unit = unit;
  }

  const date = slotValue(intent, "date");
  if (isIsoDate(date)) fields.harvestedOn = date.trim();

  return fields;
}

export const __testables = {
  normalizeUnit,
  parseCount,
  normalizeMilkUnit,
  normalizeHarvestUnit,
};
