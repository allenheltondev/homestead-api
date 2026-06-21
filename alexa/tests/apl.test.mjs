import {
  supportsApl,
  buildEggStatsDatasource,
  buildEggCostDatasource,
  addEggStatsScreen,
  addEggCostScreen,
  buildSummaryData,
  buildHerdData,
  buildConfirmationData,
  addHerdSummaryScreen,
  addConfirmationScreen,
} from "../lib/apl.mjs";
import { COLORS, herdScreenDocument } from "../apl/documents.mjs";

function handlerInput({ apl }) {
  const directives = [];
  const builder = {
    directives,
    addDirective(d) {
      directives.push(d);
      return builder;
    },
    speak() {
      return builder;
    },
    getResponse() {
      return { directives };
    },
  };
  return {
    requestEnvelope: {
      context: {
        System: {
          device: {
            supportedInterfaces: apl ? { "Alexa.Presentation.APL": {} } : {},
          },
        },
      },
    },
    responseBuilder: builder,
    _directives: directives,
  };
}

const NOW = new Date("2026-06-21T12:00:00Z");

describe("supportsApl gate", () => {
  test("true when the device exposes Alexa.Presentation.APL", () => {
    expect(supportsApl(handlerInput({ apl: true }))).toBe(true);
  });
  test("false for headless devices", () => {
    expect(supportsApl(handlerInput({ apl: false }))).toBe(false);
  });
  test("false for a malformed envelope", () => {
    expect(supportsApl({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Egg screens
// ---------------------------------------------------------------------------

describe("buildEggStatsDatasource", () => {
  test("maps count, dozens, and per-day into stat tiles", () => {
    const ds = buildEggStatsDatasource({
      count: 84,
      dozens: 7,
      perDay: 3,
      periodLabel: "this month",
    });
    expect(ds.data.subtitle).toBe("this month");
    expect(ds.data.stats).toEqual([
      { label: "eggs", value: "84" },
      { label: "dozen", value: "7" },
      { label: "per day", value: "3" },
    ]);
  });

  test("derives dozens when missing", () => {
    const ds = buildEggStatsDatasource({ count: 24 });
    expect(ds.data.stats[1].value).toBe("2");
  });
});

describe("buildEggCostDatasource", () => {
  test("cheaper badge when below store price", () => {
    const ds = buildEggCostDatasource({
      costPerDozen: 2.1,
      storePricePerDozen: 4,
    });
    expect(ds.data.badge.text).toMatch(/cheaper/i);
    expect(ds.data.badge.color).toBe(COLORS.cheaper);
    expect(ds.data.stats[0].value).toBe("$2.10");
    expect(ds.data.stats[1].value).toBe("$4");
  });

  test("pricier badge when above store price", () => {
    const ds = buildEggCostDatasource({
      costPerDozen: 5,
      storePricePerDozen: 4,
    });
    expect(ds.data.badge.text).toMatch(/pricier/i);
    expect(ds.data.badge.color).toBe(COLORS.expensive);
  });
});

describe("egg add*Screen gating", () => {
  test("addEggStatsScreen adds a RenderDocument directive when supported", () => {
    const input = handlerInput({ apl: true });
    addEggStatsScreen(input, { count: 12, perDay: 1 }).getResponse();
    expect(input._directives).toHaveLength(1);
    expect(input._directives[0].type).toBe(
      "Alexa.Presentation.APL.RenderDocument",
    );
    expect(input._directives[0].token).toBe("eggStatsToken");
  });

  test("addEggStatsScreen is a no-op on headless devices", () => {
    const input = handlerInput({ apl: false });
    addEggStatsScreen(input, { count: 12 }).getResponse();
    expect(input._directives).toHaveLength(0);
  });

  test("addEggCostScreen adds a RenderDocument directive when supported", () => {
    const input = handlerInput({ apl: true });
    addEggCostScreen(input, {
      costPerDozen: 2,
      storePricePerDozen: 4,
    }).getResponse();
    expect(input._directives).toHaveLength(1);
    expect(input._directives[0].token).toBe("eggCostToken");
  });
});

// ---------------------------------------------------------------------------
// Herd screens
// ---------------------------------------------------------------------------

describe("herd render gating", () => {
  test("adds a RenderDocument directive on APL devices", () => {
    const input = handlerInput({ apl: true });
    addHerdSummaryScreen(
      input,
      { herd: { totalAnimals: 1, bySpecies: [] } },
      NOW,
    );
    expect(input._directives).toHaveLength(1);
    expect(input._directives[0]).toMatchObject({
      type: "Alexa.Presentation.APL.RenderDocument",
      token: "herd-summary",
      document: herdScreenDocument,
    });
    expect(input._directives[0].datasources.homestead.title).toBe(
      "Herd Summary",
    );
  });

  test("does not add a directive on headless devices", () => {
    const input = handlerInput({ apl: false });
    const returned = addConfirmationScreen(input, "Birth recorded", "Got it.");
    expect(input._directives).toHaveLength(0);
    expect(returned).toBe(input.responseBuilder);
  });
});

describe("herd datasource builders", () => {
  test("buildSummaryData maps herd, species, and footer", () => {
    const data = buildSummaryData(
      {
        herd: {
          totalAnimals: 27,
          bySpecies: [
            { species: "cattle", active: 12 },
            { species: "sheep", active: 15 },
          ],
        },
        births: { thisMonth: 3 },
        deaths: { thisMonth: 1 },
        feed: { thisMonthSpend: 240 },
      },
      NOW,
    );
    expect(data.total).toBe("27 animals");
    expect(data.species).toEqual([
      { name: "Cattle", count: "12" },
      { name: "Sheep", count: "15" },
    ]);
    expect(data.footer).toEqual(["3 births", "1 death", "$240 feed"]);
  });

  test("buildSummaryData handles an empty herd", () => {
    const data = buildSummaryData({}, NOW);
    expect(data.total).toBe("0 animals");
    expect(data.species).toEqual([]);
    expect(data.footer[0]).toBe("0 births");
  });

  test("buildHerdData maps a bySpecies map and active count", () => {
    const data = buildHerdData(
      { total: 5, byStatus: { active: 4 }, bySpecies: { goat: { total: 5 } } },
      NOW,
    );
    expect(data.total).toBe("5 animals");
    expect(data.species).toEqual([{ name: "Goat", count: "5" }]);
    expect(data.footer).toEqual(["4 active", "1 species", ""]);
  });

  test("buildConfirmationData defaults a missing message", () => {
    expect(buildConfirmationData("Done")).toEqual({
      title: "Done",
      message: "",
    });
  });
});

describe("herd documents", () => {
  test("herdScreenDocument is a valid APL document", () => {
    expect(herdScreenDocument.type).toBe("APL");
    expect(herdScreenDocument.mainTemplate.parameters).toContain("payload");
  });
});
