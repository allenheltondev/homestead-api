import {
  renderSummary,
  renderHerdCount,
  renderBirthConfirmation,
  renderFeedConfirmation,
  renderEggLogged,
  renderEggStats,
  renderEggCost,
  renderFeedUsageLogged,
  renderFeedInventory,
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

  test("feed confirmation reads bags, weight, type, and computed total", () => {
    const speech = renderFeedConfirmation({
      bags: 4,
      bagWeightLbs: 50,
      feedType: "chicken",
    });
    expect(speech).toContain("4 fifty-pound bags of chicken feed");
    expect(speech).toContain("200 pounds");
  });

  test("feed confirmation uses a server total when provided", () => {
    const speech = renderFeedConfirmation({
      bags: 2,
      bagWeightLbs: 40,
      feedType: "goat",
      totalLbs: 80,
      cost: 30,
    });
    expect(speech).toContain("2 forty-pound bags of goat feed");
    expect(speech).toContain("80 pounds");
    expect(speech).toContain("30 dollars");
  });
});

describe("renderEggLogged", () => {
  test("pluralizes the egg count", () => {
    expect(renderEggLogged({ count: 9 })).toContain("9 eggs");
    expect(renderEggLogged({ count: 1 })).toContain("1 egg");
  });
});

describe("renderEggStats", () => {
  test("speaks count, dozens, and per-day rate", () => {
    const speech = renderEggStats({
      count: 84,
      dozens: 7,
      perDay: 3,
      periodLabel: "this month",
    });
    expect(speech).toContain("84 eggs this month");
    expect(speech).toContain("7 dozen");
    expect(speech).toContain("about 3 eggs a day");
  });

  test("derives dozens when not supplied", () => {
    const speech = renderEggStats({ count: 24, perDay: 1 });
    expect(speech).toContain("2 dozen");
  });

  test("handles no eggs", () => {
    expect(renderEggStats({ count: 0 })).toMatch(/haven't collected any eggs/);
  });

  test("null payload", () => {
    expect(renderEggStats(null)).toMatch(/couldn't read/);
  });
});

describe("renderEggCost", () => {
  test("says cheaper when below the store price", () => {
    const speech = renderEggCost({
      costPerDozen: 2.1,
      storePricePerDozen: 4,
    });
    expect(speech).toContain("$2.10 a dozen");
    expect(speech).toContain("cheaper than the $4 store price");
  });

  test("says more expensive when above the store price", () => {
    const speech = renderEggCost({
      costPerDozen: 5,
      storePricePerDozen: 4,
    });
    expect(speech).toContain("more expensive than the $4 store price");
  });

  test("omits comparison without a store price", () => {
    const speech = renderEggCost({ costPerDozen: 3 });
    expect(speech).toContain("$3 a dozen");
    expect(speech).not.toContain("store price");
  });

  test("speakDollars formats cents and whole dollars", () => {
    expect(__testables.speakDollars(4)).toBe("$4");
    expect(__testables.speakDollars(2.1)).toBe("$2.10");
  });
});

describe("renderFeedUsageLogged", () => {
  test("reads back amount and feed type", () => {
    const speech = renderFeedUsageLogged({ lbs: 25, feedType: "chicken" });
    expect(speech).toContain("25 pounds");
    expect(speech).toContain("chicken feed");
  });

  test("singular pound", () => {
    expect(renderFeedUsageLogged({ lbs: 1, feedType: "goat" })).toContain(
      "1 pound of goat feed",
    );
  });

  test("falls back without an amount", () => {
    expect(renderFeedUsageLogged({ feedType: "hay" })).toMatch(/some hay feed/);
  });

  test("null payload", () => {
    expect(renderFeedUsageLogged(null)).toMatch(/logged that feed usage/);
  });
});

describe("renderFeedInventory", () => {
  test("single type: speaks on-hand, days remaining, and run-out date", () => {
    const speech = renderFeedInventory({
      feedType: "chicken",
      onHandLbs: 120,
      daysRemaining: 12,
      runOutDate: "2026-07-03",
    });
    expect(speech).toContain("120 pounds of chicken feed left");
    expect(speech).toContain("about 12 days");
    expect(speech).toContain("running out around");
    expect(speech).toContain("July 3");
  });

  test("rollup with items joins each feed type", () => {
    const speech = renderFeedInventory({
      items: [
        { feedType: "chicken", onHandLbs: 100, daysRemaining: 10 },
        { feedType: "goat", onHandLbs: 40, daysRemaining: 4 },
      ],
    });
    expect(speech).toContain("100 pounds of chicken feed left");
    expect(speech).toContain("40 pounds of goat feed left");
  });

  test("says you're out when nothing on hand", () => {
    expect(
      renderFeedInventory({ feedType: "hay", onHandLbs: 0 }),
    ).toMatch(/out of hay feed/);
  });

  test("empty rollup", () => {
    expect(renderFeedInventory({ items: [] })).toMatch(/don't have any feed/);
  });

  test("null payload", () => {
    expect(renderFeedInventory(null)).toMatch(/couldn't read/);
  });
});
