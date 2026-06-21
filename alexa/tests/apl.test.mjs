import {
  supportsApl,
  buildSummaryData,
  buildHerdData,
  buildConfirmationData,
  addHerdSummaryScreen,
  addConfirmationScreen,
} from "../lib/apl.mjs";
import { herdScreenDocument } from "../apl/documents.mjs";

// A responseBuilder that records addDirective calls and chains.
function makeRb() {
  const directives = [];
  const rb = {
    directives,
    addDirective(d) {
      directives.push(d);
      return rb;
    },
    speak() {
      return rb;
    },
    getResponse() {
      return { directives };
    },
  };
  return rb;
}

function handlerInput({ apl, rb }) {
  const device = apl
    ? { supportedInterfaces: { "Alexa.Presentation.APL": {} } }
    : { supportedInterfaces: {} };
  return {
    requestEnvelope: { context: { System: { device } } },
    responseBuilder: rb,
  };
}

const NOW = new Date("2026-06-21T12:00:00Z");

describe("supportsApl", () => {
  test("true when the device advertises the APL interface", () => {
    expect(supportsApl(handlerInput({ apl: true, rb: makeRb() }))).toBe(true);
  });
  test("false on headless devices / missing context", () => {
    expect(supportsApl(handlerInput({ apl: false, rb: makeRb() }))).toBe(false);
    expect(supportsApl({})).toBe(false);
  });
});

describe("render gating", () => {
  test("adds a RenderDocument directive on APL devices", () => {
    const rb = makeRb();
    addHerdSummaryScreen(
      handlerInput({ apl: true, rb }),
      { herd: { totalAnimals: 1, bySpecies: [] } },
      NOW,
    );
    expect(rb.directives).toHaveLength(1);
    expect(rb.directives[0]).toMatchObject({
      type: "Alexa.Presentation.APL.RenderDocument",
      token: "herd-summary",
      document: herdScreenDocument,
    });
    expect(rb.directives[0].datasources.homestead.title).toBe("Herd Summary");
  });

  test("does not add a directive on headless devices", () => {
    const rb = makeRb();
    const returned = addConfirmationScreen(
      handlerInput({ apl: false, rb }),
      "Birth recorded",
      "Got it.",
    );
    expect(rb.directives).toHaveLength(0);
    expect(returned).toBe(rb);
  });
});

describe("datasource builders", () => {
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
    expect(buildConfirmationData("Done")).toEqual({ title: "Done", message: "" });
  });
});

describe("documents", () => {
  test("are valid APL documents", () => {
    expect(herdScreenDocument.type).toBe("APL");
    expect(herdScreenDocument.mainTemplate.parameters).toContain("payload");
  });
});
