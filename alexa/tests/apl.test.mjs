import {
  supportsApl,
  buildEggStatsDatasource,
  buildEggCostDatasource,
  addEggStatsScreen,
  addEggCostScreen,
} from "../lib/apl.mjs";
import { COLORS } from "../apl/documents.mjs";

function handlerInput({ apl }) {
  const directives = [];
  const builder = {
    addDirective(d) {
      directives.push(d);
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

describe("add*Screen gating", () => {
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
