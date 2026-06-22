// Tool registry for the farm-copilot Bedrock Nova Pro Converse loop
// (api/copilot.mjs). Unlike the Alexa skill's tools (which call the REST API
// over HTTP), these run the read-only domain/stats aggregations IN-PROCESS:
// each REGISTRY handler invokes the matching function in api/domain/stats.mjs
// (or careTask / GRN) directly against DynamoDB and returns a JSON-serializable
// result that is fed back to the model.
//
// EVERYTHING here is READ-ONLY -- there are no create/update/delete tools, so
// the copilot can answer questions but can never mutate homestead data.
//
// Two exports:
//   TOOL_SPECS -- the Bedrock Converse `{ toolSpec }` array (name, description,
//                 inputSchema.json) passed as toolConfig.tools to ConverseCommand.
//   REGISTRY   -- name -> async handler(input) that runs the read and returns
//                 JSON-serializable data.

import {
  herdStats,
  eggStatsForPeriod,
  eggCostStats,
  feedInventory,
  milkStats,
  milkCostStats,
  healthStats,
  mortalityStats,
  pnlStats,
  gardenStats,
  monthsForPeriod,
} from "../domain/stats.mjs";
import { listCareTasksDue } from "../domain/careTask.mjs";
import { isGrnConfigured, listMyListings } from "../lib/grn.mjs";
import { GrnNotConfiguredError, GrnUnauthorizedError } from "../services/errors.mjs";
import { yyyymm } from "../services/time.mjs";

// Resolves a tool's optional `period` input to a { period, months } pair the
// stats functions consume. Accepts a YYYY or YYYY-MM string; anything else
// (including absent) falls back to the current month so a vague question still
// gets grounded numbers instead of an error.
function resolvePeriod(input, now = new Date()) {
  const raw = typeof input?.period === "string" ? input.period.trim() : "";
  const months = monthsForPeriod(raw);
  if (months) return { period: raw, months };
  const month = yyyymm(now);
  return { period: month, months: [month] };
}

// The Bedrock Converse toolSpec definitions. Descriptions are prescriptive
// about WHEN to reach for each tool so the model picks the right one.
export const TOOL_SPECS = [
  {
    toolSpec: {
      name: "get_herd_summary",
      description:
        "Get current animal head counts broken down by species and by status "
        + "(active, deceased, sold). Use for any question about how many animals "
        + "are on the farm or the makeup of the herd.",
      inputSchema: { json: { type: "object", properties: {}, required: [] } },
    },
  },
  {
    toolSpec: {
      name: "get_egg_stats",
      description:
        "Get egg-production stats for a period: total eggs, dozens, collection "
        + "days, eggs per day, and a per-bird-type breakdown. Use for questions "
        + "about how many eggs were collected or laying productivity.",
      inputSchema: {
        json: {
          type: "object",
          properties: { period: periodProp() },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_egg_cost",
      description:
        "Get the cost to produce a dozen eggs for a period (poultry feed spend "
        + "divided by dozens) plus the comparison to the store price and the "
        + "savings per dozen. Use when asked whether eggs are cheaper than the "
        + "store or what eggs cost to produce.",
      inputSchema: {
        json: {
          type: "object",
          properties: { period: periodProp() },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_feed_inventory",
      description:
        "Get on-hand feed by feed type: pounds on hand, value, 30-day burn "
        + "rate, days remaining, and projected run-out date, plus totals. Use "
        + "for questions about how much feed is left, when feed will run out, "
        + "or which feed is running low.",
      inputSchema: { json: { type: "object", properties: {}, required: [] } },
    },
  },
  {
    toolSpec: {
      name: "get_milk_stats",
      description:
        "Get milk-production stats for a period: total gallons, logging days, "
        + "average gallons per day, and a per-animal breakdown. Use for "
        + "questions about how much milk was produced.",
      inputSchema: {
        json: {
          type: "object",
          properties: { period: periodProp() },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_milk_cost",
      description:
        "Get the cost to produce a gallon of milk for a period (goat feed spend "
        + "divided by gallons) plus the comparison to the market price and the "
        + "savings per gallon. Use when asked what milk costs to produce or "
        + "whether it beats the store price.",
      inputSchema: {
        json: {
          type: "object",
          properties: { period: periodProp() },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_health_spend",
      description:
        "Get animal-health spending for a period: total spend, spend grouped by "
        + "category (vet, medicine, supplies, testing), and a per-active-animal "
        + "figure. Use for questions about vet bills or health costs.",
      inputSchema: {
        json: {
          type: "object",
          properties: { period: periodProp() },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_mortality",
      description:
        "Get mortality for a period: total deaths, deaths grouped by cause, and "
        + "the approximate loss rate (deaths over the average active herd). Use "
        + "for questions about how many animals were lost or why.",
      inputSchema: {
        json: {
          type: "object",
          properties: { period: periodProp() },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_pnl",
      description:
        "Get the homestead profit & loss for a period: costs (feed + health), "
        + "outputs (egg / milk / meat / produce value + actual sales), and the "
        + "net. Use for questions about whether the farm is making or losing "
        + "money, or its overall financial picture.",
      inputSchema: {
        json: {
          type: "object",
          properties: { period: periodProp() },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_garden_stats",
      description:
        "Get garden harvest totals for a period grouped by crop, sourced from "
        + "the Good Roots Network. Use for questions about what was harvested "
        + "and how much.",
      inputSchema: {
        json: {
          type: "object",
          properties: { period: periodProp() },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_care_tasks_due",
      description:
        "Get recurring care tasks (worming, hoof trims, vaccinations, etc.) due "
        + "within an optional number of days (default 7). Use for questions "
        + "about what farm chores or animal-care tasks are coming up.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            withinDays: {
              type: "integer",
              description:
                "How many days ahead to look for due care tasks. Defaults to 7.",
            },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "get_grn_my_listings",
      description:
        "Get the homestead's own produce listings on the Good Roots Network "
        + "(GRN) sharing marketplace, optionally filtered by status (e.g. open, "
        + "claimed). Use for questions about what the farm has listed to give "
        + "away or sell on GRN. Returns an empty list when GRN is not "
        + "configured.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            status: {
              type: "string",
              description:
                "Optional listing status filter, e.g. 'open' or 'claimed'.",
            },
          },
          required: [],
        },
      },
    },
  },
];

// Shared `period` schema property. A YYYY or YYYY-MM string; absent defaults to
// the current month.
function periodProp() {
  return {
    type: "string",
    description:
      "Optional period as a year (YYYY) or month (YYYY-MM). Defaults to the "
      + "current month when omitted.",
  };
}

// name -> async handler(input) -> JSON-serializable data. Every handler runs a
// read-only aggregation in-process. The copilot loop feeds the returned object
// back to the model as a toolResult.
export const REGISTRY = {
  async get_herd_summary() {
    return herdStats();
  },

  async get_egg_stats(input) {
    const { period, months } = resolvePeriod(input);
    return eggStatsForPeriod(period, months);
  },

  async get_egg_cost(input) {
    const { period, months } = resolvePeriod(input);
    return eggCostStats(period, months);
  },

  async get_feed_inventory() {
    return feedInventory();
  },

  async get_milk_stats(input) {
    const { period, months } = resolvePeriod(input);
    return milkStats(period, months);
  },

  async get_milk_cost(input) {
    const { period, months } = resolvePeriod(input);
    return milkCostStats(period, months);
  },

  async get_health_spend(input) {
    const { period, months } = resolvePeriod(input);
    return healthStats(period, months);
  },

  async get_mortality(input) {
    const { period, months } = resolvePeriod(input);
    return mortalityStats(period, months);
  },

  async get_pnl(input) {
    const { period, months } = resolvePeriod(input);
    return pnlStats(period, months);
  },

  async get_garden_stats(input) {
    const { period, months } = resolvePeriod(input);
    return gardenStats(period, months);
  },

  async get_care_tasks_due(input) {
    const withinDays = Number.isInteger(input?.withinDays) && input.withinDays > 0
      ? input.withinDays
      : 7;
    const tasks = await listCareTasksDue(withinDays);
    return {
      withinDays,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        target: t.target,
        nextDueAt: t.nextDueAt,
      })),
    };
  },

  // Best-effort: GRN is an optional outbound integration. When it is not
  // configured (or rejects credentials) we degrade to an empty list with a
  // flag rather than failing the whole copilot turn.
  async get_grn_my_listings(input) {
    if (!isGrnConfigured()) {
      return { configured: false, listings: [] };
    }
    try {
      const status = typeof input?.status === "string" ? input.status : undefined;
      const result = await listMyListings({ status, limit: 100 });
      const items = Array.isArray(result) ? result : (result?.items ?? []);
      return {
        configured: true,
        listings: items.map((l) => ({
          id: l?.id ?? null,
          title: l?.title ?? l?.cropName ?? l?.crop_name ?? null,
          status: l?.status ?? null,
        })),
      };
    } catch (err) {
      if (err instanceof GrnNotConfiguredError || err instanceof GrnUnauthorizedError) {
        return { configured: false, listings: [] };
      }
      throw err;
    }
  },
};
