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

// Builds the POST /births body. Only `species` is required by the API; status
// defaults to active server-side. Optional name/breed/sex/dob are forwarded
// when present.
export function buildBirthFields(intent) {
  const species = slotValue(intent, "species");
  if (!species || !species.trim()) {
    return {
      ok: false,
      reprompt: "What species was born? For example, a goat or a cow.",
    };
  }

  const fields = { species: species.trim() };

  const name = slotValue(intent, "name");
  if (name && name.trim()) fields.name = name.trim();

  const breed = slotValue(intent, "breed");
  if (breed && breed.trim()) fields.breed = breed.trim();

  const sex = slotValue(intent, "sex");
  if (sex) {
    const normalized = sex.trim().toLowerCase();
    if (["female", "male", "unknown"].includes(normalized)) {
      fields.sex = normalized;
    }
  }

  const dob = slotValue(intent, "dob");
  if (dob && /^\d{4}-\d{2}-\d{2}$/.test(dob.trim())) fields.dob = dob.trim();

  return { ok: true, fields };
}

// Builds the POST /feed-purchases body. The API requires type, a positive
// quantity, a known unit, a non-negative cost, and a vendor. We ask for any
// missing required slot.
export function buildFeedFields(intent) {
  const type = slotValue(intent, "type");
  if (!type || !type.trim()) {
    return {
      ok: false,
      reprompt: "What type of feed did you buy? For example, hay or grain.",
    };
  }

  const quantityRaw = slotValue(intent, "quantity");
  const quantity = Number(quantityRaw);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      ok: false,
      reprompt: "How much did you buy? Please give a quantity.",
    };
  }

  const unit = normalizeUnit(slotValue(intent, "unit"));
  if (!unit) {
    return {
      ok: false,
      reprompt:
        "What unit was that in? For example, pounds, bags, or bales.",
    };
  }

  const costRaw = slotValue(intent, "cost");
  const cost = Number(costRaw);
  if (!Number.isFinite(cost) || cost < 0) {
    return {
      ok: false,
      reprompt: "How much did it cost?",
    };
  }

  const vendorRaw = slotValue(intent, "vendor");
  const vendor = vendorRaw && vendorRaw.trim() ? vendorRaw.trim() : "unknown";

  return {
    ok: true,
    fields: {
      type: type.trim(),
      quantity,
      unit,
      cost,
      vendor,
    },
  };
}

export const __testables = { normalizeUnit };
