import {
  renderSummary,
  renderHerdCount,
  renderBirthConfirmation,
  renderFeedConfirmation,
  __testables,
} from "../lib/speech.mjs";

describe("speech helpers", () => {
  test("speakList joins naturally", () => {
    expect(__testables.speakList([])).toBe("");
    expect(__testables.speakList(["a"])).toBe("a");
    expect(__testables.speakList(["a", "b"])).toBe("a and b");
    expect(__testables.speakList(["a", "b", "c"])).toBe("a, b, and c");
  });

  test("pluralize respects count", () => {
    expect(__testables.pluralize(1, "goat")).toBe("1 goat");
    expect(__testables.pluralize(2, "goat")).toBe("2 goats");
  });

  test("speakMoney drops cents for whole dollars", () => {
    expect(__testables.speakMoney(40)).toBe("40 dollars");
    expect(__testables.speakMoney(1)).toBe("1 dollar");
    expect(__testables.speakMoney(12.5)).toBe("12.50 dollars");
  });
});

describe("renderSummary", () => {
  const summary = {
    asOf: { month: "2026-06", year: "2026" },
    herd: {
      totalAnimals: 5,
      activeAnimals: 4,
      bySpecies: [
        { species: "goat", total: 3, active: 3 },
        { species: "cow", total: 2, active: 1 },
      ],
    },
    births: { thisMonth: 1, thisYear: 4 },
    deaths: { thisMonth: 0, thisYear: 1 },
    feed: { thisMonthSpend: 120, thisMonthQuantity: 300 },
  };

  test("speaks herd, births/deaths, and feed spend", () => {
    const speech = renderSummary(summary);
    expect(speech).toContain("5 animals");
    expect(speech).toContain("3 goats");
    expect(speech).toContain("1 cow");
    expect(speech).toContain("1 birth");
    expect(speech).toContain("0 deaths");
    expect(speech).toContain("120 dollars");
  });

  test("handles an empty herd", () => {
    const empty = {
      herd: { totalAnimals: 0, activeAnimals: 0, bySpecies: [] },
      births: { thisMonth: 0 },
      deaths: { thisMonth: 0 },
      feed: { thisMonthSpend: 0 },
    };
    const speech = renderSummary(empty);
    expect(speech).toContain("don't have any animals");
    expect(speech).toContain("0 dollars");
  });

  test("singular birth uses 'was'", () => {
    const speech = renderSummary(summary);
    expect(speech).toContain("there was 1 birth");
  });

  test("gracefully handles a null payload", () => {
    expect(renderSummary(null)).toMatch(/couldn't read/);
  });
});

describe("renderHerdCount", () => {
  test("speaks total and active counts by species", () => {
    const herd = {
      total: 5,
      byStatus: { active: 4, deceased: 1, sold: 0 },
      bySpecies: {
        goat: { total: 3, active: 3 },
        cow: { total: 2, active: 1 },
      },
    };
    const speech = renderHerdCount(herd);
    expect(speech).toContain("5 animals");
    expect(speech).toContain("3 goats");
    expect(speech).toContain("4 animals are active");
  });

  test("empty herd", () => {
    expect(renderHerdCount({ total: 0, byStatus: { active: 0 } })).toMatch(
      /any animals/,
    );
  });
});

describe("confirmations", () => {
  test("birth confirmation names the species", () => {
    expect(renderBirthConfirmation({ animal: { species: "goat" } })).toContain(
      "goat",
    );
  });

  test("feed confirmation includes quantity, unit, type, and cost", () => {
    const speech = renderFeedConfirmation({
      type: "hay",
      quantity: 10,
      unit: "bale",
      cost: 80,
    });
    expect(speech).toContain("10 bale of hay");
    expect(speech).toContain("80 dollars");
  });
});
