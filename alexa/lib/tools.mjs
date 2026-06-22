// Tool registry for the Nova Pro agentic fallback (lib/agent.mjs). When no
// structured intent matches a phrase, the skill hands the utterance to an
// Amazon Nova Pro model on Bedrock that drives these tools via the Converse
// API's tool-use protocol.
//
// Each entry is exposed to the model as a Bedrock `{ toolSpec }` (name +
// description + JSON-Schema input) AND mapped — in REGISTRY — to a runner that
// reuses the existing lib/api.mjs client. Tools split into two kinds:
//
//   READ  — executed inline inside the agent loop; the result is fed back to
//           the model so it can compose a spoken answer.
//   WRITE — NOT executed inline. The loop captures the model's FIRST requested
//           write as a pendingAction and asks the user to confirm out loud
//           before anything is mutated (see lib/agent.mjs + the confirm-gated
//           Yes/No handlers in handlers/intents.mjs).

// ---------------------------------------------------------------------------
// Bedrock toolSpec definitions (name + description + inputSchema.json).
// These are the `toolConfig.tools` array passed to ConverseCommand.
// ---------------------------------------------------------------------------

const periodProperty = {
  period: {
    type: "string",
    description:
      "Optional natural-language period such as 'this month', 'this week', or 'this year'.",
  },
};

export const TOOL_SPECS = [
  // --- READ tools --------------------------------------------------------
  {
    toolSpec: {
      name: "get_summary",
      description:
        "Get a speakable rollup of the whole homestead: herd by species, births and deaths this month, and feed spend this month.",
      inputSchema: { json: { type: "object", properties: {}, required: [] } },
    },
  },
  {
    toolSpec: {
      name: "get_herd",
      description:
        "Get current animal counts broken down by species and status (active, sold, dead).",
      inputSchema: { json: { type: "object", properties: {}, required: [] } },
    },
  },
  {
    toolSpec: {
      name: "get_egg_stats",
      description:
        "Get egg-collection stats (total eggs, dozens, eggs per day) for an optional period.",
      inputSchema: {
        json: { type: "object", properties: { ...periodProperty }, required: [] },
      },
    },
  },
  {
    toolSpec: {
      name: "get_egg_cost",
      description:
        "Get the cost per dozen eggs compared to the store price, for an optional period and optional flock (coop).",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            ...periodProperty,
            flock: {
              type: "string",
              description: "Optional flock or coop name to filter the cost to.",
            },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_feed_inventory",
      description:
        "Get on-hand feed amounts and projected run-out dates, optionally filtered to a single feed type (e.g. chicken, cattle, hay).",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            feedType: {
              type: "string",
              description: "Optional feed type to filter to (chicken, cattle, goat, sheep, pig, horse, hay, grain).",
            },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_health_stats",
      description:
        "Get total animal-health spending (vet, medicine, supplies, testing) for an optional period.",
      inputSchema: {
        json: { type: "object", properties: { ...periodProperty }, required: [] },
      },
    },
  },
  {
    toolSpec: {
      name: "get_mortality",
      description:
        "Get how many animals were lost and the loss rate for an optional period.",
      inputSchema: {
        json: { type: "object", properties: { ...periodProperty }, required: [] },
      },
    },
  },
  {
    toolSpec: {
      name: "get_digest",
      description:
        "Get the weekly homestead digest: a short list of speakable highlights.",
      inputSchema: { json: { type: "object", properties: {}, required: [] } },
    },
  },
  {
    toolSpec: {
      name: "get_milk_stats",
      description:
        "Get milk production stats (total volume and per-day rate) for an optional period.",
      inputSchema: {
        json: { type: "object", properties: { ...periodProperty }, required: [] },
      },
    },
  },
  {
    toolSpec: {
      name: "get_milk_cost",
      description:
        "Get the cost per gallon of milk compared to the store price, for an optional period.",
      inputSchema: {
        json: { type: "object", properties: { ...periodProperty }, required: [] },
      },
    },
  },
  {
    toolSpec: {
      name: "get_care_due",
      description:
        "Get the animal care tasks coming due soon (deworming, hoof trims, vaccinations, etc.), optionally within a number of days.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            withinDays: {
              type: "number",
              description: "Optional window in days to look ahead for due tasks.",
            },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_upcoming_due",
      description:
        "Get what's due to hatch or give birth soon: upcoming kiddings/calvings/etc. and incubation hatches. Optionally within a number of days.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            withinDays: {
              type: "number",
              description: "Optional window in days to look ahead.",
            },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_pnl",
      description:
        "Get the homestead profit and loss (income, expenses, and net) for an optional period. Use this for 'am I in the black' or 'homestead profit' questions.",
      inputSchema: {
        json: { type: "object", properties: { ...periodProperty }, required: [] },
      },
    },
  },

  // --- WRITE tools (confirm-gated; never executed inline) -----------------
  {
    toolSpec: {
      name: "log_feed_purchase",
      description:
        "Record a feed purchase. Provide the number of bags, the per-bag weight in pounds, and the feed type.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            bags: { type: "number", description: "Number of bags purchased." },
            bagWeightLbs: {
              type: "number",
              description: "Weight of each bag in pounds.",
            },
            feedType: {
              type: "string",
              description: "Feed type (e.g. chicken, cattle, goat, hay).",
            },
            cost: { type: "number", description: "Optional total cost in dollars." },
          },
          required: ["bags", "bagWeightLbs", "feedType"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "log_feed_usage",
      description:
        "Record feed fed out to the animals so on-hand inventory draws down. Provide the amount in pounds and the feed type.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            lbs: { type: "number", description: "Pounds of feed fed out." },
            feedType: {
              type: "string",
              description: "Feed type fed out (e.g. chicken, cattle, hay).",
            },
          },
          required: ["lbs", "feedType"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "log_egg_collection",
      description: "Log an egg collection. Provide the number of eggs collected.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            count: { type: "number", description: "Number of eggs collected." },
            coop: { type: "string", description: "Optional coop or flock name." },
          },
          required: ["count"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "record_birth",
      description:
        "Record an animal birth. Provide the species and the number born.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            species: { type: "string", description: "Species born (e.g. goat, sheep, chicken)." },
            count: { type: "number", description: "Number of animals born." },
            dam: { type: "string", description: "Optional mother (dam) name." },
            sire: { type: "string", description: "Optional father (sire) name." },
          },
          required: ["species", "count"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "record_death",
      description:
        "Record an animal death. Provide which animal died (a name or reference).",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            animalRef: {
              type: "string",
              description: "Name or reference of the animal that died.",
            },
            cause: { type: "string", description: "Optional cause of death." },
          },
          required: ["animalRef"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "move_animals",
      description:
        "Move a group of animals to a pasture. Provide the group and the destination pasture.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            group: { type: "string", description: "Group of animals to move." },
            pasture: { type: "string", description: "Destination pasture." },
          },
          required: ["group", "pasture"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "record_health_expense",
      description:
        "Record an animal-health expense. Provide the category (vet, medicine, supplies, testing) and the cost in dollars.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description: "Expense category (vet, medicine, supplies, testing).",
            },
            cost: { type: "number", description: "Cost in dollars." },
            animalRef: {
              type: "string",
              description: "Optional animal the expense applies to.",
            },
          },
          required: ["category", "cost"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "log_milk",
      description:
        "Log a milking. Provide the volume and unit (gallons, quarts, liters), and optionally which animal it came from.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            volume: { type: "number", description: "Volume of milk collected." },
            unit: {
              type: "string",
              description: "Volume unit (gallon, quart, pint, liter, ounce, cup).",
            },
            animal: {
              type: "string",
              description: "Optional animal the milk came from (e.g. Daisy).",
            },
          },
          required: ["volume"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "complete_care_task",
      description:
        "Mark an animal care task complete. Provide the task name or id (e.g. 'deworm the goats').",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description: "The care task name or id to mark complete.",
            },
          },
          required: ["task"],
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Speech helpers for the write confirmations. Kept tiny and local so the
// registry stays self-contained.
// ---------------------------------------------------------------------------

function plural(count, noun) {
  return `${count} ${noun}${Number(count) === 1 ? "" : "s"}`;
}

function dollars(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Registry: tool name -> { kind, run(args, api), describe(args) }.
//
//   kind     — "read" or "write".
//   run      — invokes the matching lib/api.mjs method. READ runners are called
//              inline in the loop; WRITE runners are called only after the user
//              confirms (from the Yes handler), never inside the loop.
//   describe — a short human-readable confirmation phrase for WRITE tools
//              (e.g. "Record the death of Bessie"). READ tools describe their
//              own action for logging/symmetry.
// ---------------------------------------------------------------------------

export const REGISTRY = {
  // --- READ --------------------------------------------------------------
  get_summary: {
    kind: "read",
    run: (_args, api) => api.getSummary(),
    describe: () => "Get the homestead summary",
  },
  get_herd: {
    kind: "read",
    run: (_args, api) => api.getHerd(),
    describe: () => "Get the herd count",
  },
  get_egg_stats: {
    kind: "read",
    run: (args, api) => api.getEggStats(pickPeriod(args)),
    describe: () => "Get egg stats",
  },
  get_egg_cost: {
    kind: "read",
    run: (args, api) => api.getEggCost(pickEggCost(args)),
    describe: () => "Get egg cost",
  },
  get_feed_inventory: {
    kind: "read",
    run: (args, api) => api.getFeedInventory(textOrUndefined(args?.feedType)),
    describe: () => "Get feed inventory",
  },
  get_health_stats: {
    kind: "read",
    run: (args, api) => api.getHealthStats(pickPeriod(args)),
    describe: () => "Get health spending",
  },
  get_mortality: {
    kind: "read",
    run: (args, api) => api.getMortality(pickPeriod(args)),
    describe: () => "Get mortality stats",
  },
  get_digest: {
    kind: "read",
    run: (_args, api) => api.getDigest(),
    describe: () => "Get the weekly digest",
  },
  get_milk_stats: {
    kind: "read",
    run: (args, api) => api.getMilkStats(pickPeriod(args)),
    describe: () => "Get milk stats",
  },
  get_milk_cost: {
    kind: "read",
    run: (args, api) => api.getMilkCost(pickPeriod(args)),
    describe: () => "Get milk cost",
  },
  get_care_due: {
    kind: "read",
    run: (args, api) => api.getCareDue(pickWithinDays(args)),
    describe: () => "Get care tasks due",
  },
  get_upcoming_due: {
    kind: "read",
    run: (args, api) => api.getUpcomingDue(pickWithinDays(args)),
    describe: () => "Get what's due to hatch or give birth",
  },
  get_pnl: {
    kind: "read",
    run: (args, api) => api.getPnl(pickPeriod(args)),
    describe: () => "Get profit and loss",
  },

  // --- WRITE -------------------------------------------------------------
  log_feed_purchase: {
    kind: "write",
    run: (args, api) => api.recordFeedPurchase(cleanFeedPurchase(args)),
    describe: (args) => {
      const bags = args?.bags;
      const weight = args?.bagWeightLbs;
      const type = args?.feedType ?? "feed";
      if (bags != null && weight != null) {
        return `Record a purchase of ${plural(bags, `${weight}-pound bag`)} of ${type} feed`;
      }
      return `Record a ${type} feed purchase`;
    },
  },
  log_feed_usage: {
    kind: "write",
    run: (args, api) => api.recordFeedUsage(cleanFeedUsage(args)),
    describe: (args) =>
      `Log ${plural(args?.lbs ?? 0, "pound")} of ${args?.feedType ?? "feed"} feed fed out`,
  },
  log_egg_collection: {
    kind: "write",
    run: (args, api) => api.recordEggCollection(cleanEggCollection(args)),
    describe: (args) => `Log ${plural(args?.count ?? 0, "egg")} collected`,
  },
  record_birth: {
    kind: "write",
    run: (args, api) => api.recordBirth(cleanBirth(args)),
    describe: (args) =>
      `Record the birth of ${plural(args?.count ?? 1, args?.species ?? "animal")}`,
  },
  record_death: {
    kind: "write",
    run: (args, api) => api.recordDeath(cleanDeath(args)),
    describe: (args) => `Record the death of ${args?.animalRef ?? "an animal"}`,
  },
  move_animals: {
    kind: "write",
    run: (args, api) => api.moveAnimals(cleanMove(args)),
    describe: (args) =>
      `Move ${args?.group ?? "the animals"} to ${args?.pasture ?? "the pasture"}`,
  },
  record_health_expense: {
    kind: "write",
    run: (args, api) => api.recordHealthExpense(cleanHealthExpense(args)),
    describe: (args) => {
      const cost = dollars(args?.cost);
      const category = args?.category ?? "health";
      return cost
        ? `Record a ${cost} ${category} expense`
        : `Record a ${category} expense`;
    },
  },
  log_milk: {
    kind: "write",
    run: (args, api) => api.recordMilk(cleanMilk(args)),
    describe: (args) => {
      const volume = args?.volume;
      const unit = args?.unit ?? "gallon";
      const from = args?.animal ? ` from ${args.animal}` : "";
      return volume != null
        ? `Log ${plural(volume, unit)} of milk${from}`
        : `Log a milking${from}`;
    },
  },
  complete_care_task: {
    kind: "write",
    run: (args, api) => api.completeCareTask(textOrUndefined(args?.task)),
    describe: (args) =>
      `Mark ${args?.task ?? "that care task"} complete`,
  },
};

// ---------------------------------------------------------------------------
// Argument normalizers. The model returns free-form JSON; these keep only the
// fields the API accepts and drop empty/invalid values so the request bodies
// match what lib/api.mjs expects.
// ---------------------------------------------------------------------------

function textOrUndefined(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function numberOrUndefined(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function pickPeriod(args) {
  const period = textOrUndefined(args?.period);
  return period ? { period } : {};
}

function pickEggCost(args) {
  const query = pickPeriod(args);
  const flock = textOrUndefined(args?.flock);
  if (flock) query.flock = flock;
  return query;
}

function cleanFeedPurchase(args) {
  const fields = {};
  const bags = numberOrUndefined(args?.bags);
  const bagWeightLbs = numberOrUndefined(args?.bagWeightLbs);
  const feedType = textOrUndefined(args?.feedType);
  const cost = numberOrUndefined(args?.cost);
  if (bags != null) fields.bags = bags;
  if (bagWeightLbs != null) fields.bagWeightLbs = bagWeightLbs;
  if (feedType) fields.feedType = feedType;
  if (cost != null) fields.cost = cost;
  return fields;
}

function cleanFeedUsage(args) {
  const fields = {};
  const lbs = numberOrUndefined(args?.lbs);
  const feedType = textOrUndefined(args?.feedType);
  if (lbs != null) fields.lbs = lbs;
  if (feedType) fields.feedType = feedType;
  return fields;
}

function cleanEggCollection(args) {
  const fields = {};
  const count = numberOrUndefined(args?.count);
  const coop = textOrUndefined(args?.coop);
  if (count != null) fields.count = count;
  if (coop) fields.coop = coop;
  return fields;
}

function cleanBirth(args) {
  const fields = {};
  const species = textOrUndefined(args?.species);
  const count = numberOrUndefined(args?.count);
  const dam = textOrUndefined(args?.dam);
  const sire = textOrUndefined(args?.sire);
  if (species) fields.species = species;
  if (count != null) fields.count = count;
  if (dam) fields.dam = dam;
  if (sire) fields.sire = sire;
  return fields;
}

function cleanDeath(args) {
  const fields = {};
  const animalRef = textOrUndefined(args?.animalRef);
  const cause = textOrUndefined(args?.cause);
  if (animalRef) fields.animalRef = animalRef;
  if (cause) fields.cause = cause;
  return fields;
}

function cleanMove(args) {
  const fields = {};
  const group = textOrUndefined(args?.group);
  const pasture = textOrUndefined(args?.pasture);
  if (group) fields.group = group;
  if (pasture) fields.pasture = pasture;
  return fields;
}

// Returns a positive-integer day window, or undefined so the API uses its
// default look-ahead.
function pickWithinDays(args) {
  const n = numberOrUndefined(args?.withinDays);
  return n != null && n > 0 ? Math.round(n) : undefined;
}

function cleanMilk(args) {
  const fields = {};
  const volume = numberOrUndefined(args?.volume);
  const unit = textOrUndefined(args?.unit);
  const animal = textOrUndefined(args?.animal);
  if (volume != null) {
    fields.volume = volume;
    fields.unit = unit ?? "gal";
  }
  if (animal) fields.animal = animal;
  return fields;
}

function cleanHealthExpense(args) {
  const fields = {};
  const category = textOrUndefined(args?.category);
  const cost = numberOrUndefined(args?.cost);
  const animalRef = textOrUndefined(args?.animalRef);
  if (category) fields.category = category;
  if (cost != null) fields.cost = cost;
  if (animalRef) fields.animalRef = animalRef;
  return fields;
}

export const __testables = {
  pickPeriod,
  pickEggCost,
  cleanFeedPurchase,
  cleanBirth,
  cleanDeath,
  pickWithinDays,
  cleanMilk,
};
