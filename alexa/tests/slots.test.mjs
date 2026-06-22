import {
  slotValue,
  buildBirthFields,
  buildFeedFields,
  buildEggFields,
  buildDeathFields,
  buildMoveFields,
  buildPeriodQuery,
  buildEggCostQuery,
  buildFeedUsageFields,
  buildHealthExpenseFields,
  buildMilkFields,
  buildWithinDays,
  buildCareTaskRef,
  buildHarvestFields,
  __testables,
} from "../lib/slots.mjs";

function intentWith(slots) {
  return { name: "X", slots };
}

describe("slotValue", () => {
  test("prefers entity-resolution canonical value", () => {
    const intent = intentWith({
      feedType: {
        value: "layers",
        resolutions: {
          resolutionsPerAuthority: [{ values: [{ value: { name: "chicken" } }] }],
        },
      },
    });
    expect(slotValue(intent, "feedType")).toBe("chicken");
  });

  test("falls back to the spoken value", () => {
    expect(slotValue(intentWith({ species: { value: "goat" } }), "species")).toBe(
      "goat",
    );
  });

  test("undefined for a missing slot", () => {
    expect(slotValue(intentWith({}), "species")).toBeUndefined();
  });
});

describe("normalizeUnit", () => {
  test("maps synonyms to canonical API units", () => {
    expect(__testables.normalizeUnit("pounds")).toBe("lb");
    expect(__testables.normalizeUnit("Bales")).toBe("bale");
    expect(__testables.normalizeUnit("kilograms")).toBe("kg");
  });
  test("returns undefined for unknown units", () => {
    expect(__testables.normalizeUnit("scoops")).toBeUndefined();
  });
});

describe("normalizeMilkUnit", () => {
  test("maps spoken volume units to canonical tokens", () => {
    expect(__testables.normalizeMilkUnit("gallons")).toBe("gal");
    expect(__testables.normalizeMilkUnit("Quart")).toBe("qt");
    expect(__testables.normalizeMilkUnit("liters")).toBe("l");
  });
  test("returns undefined for unknown units", () => {
    expect(__testables.normalizeMilkUnit("scoops")).toBeUndefined();
  });
});

describe("parseCount", () => {
  test("parses numeric strings", () => {
    expect(__testables.parseCount("12")).toBe(12);
    expect(__testables.parseCount(7)).toBe(7);
  });
  test("maps spoken quantities", () => {
    expect(__testables.parseCount("a dozen")).toBe(12);
    expect(__testables.parseCount("DOZEN")).toBe(12);
    expect(__testables.parseCount("half dozen")).toBe(6);
    expect(__testables.parseCount("two dozen")).toBe(24);
  });
  test("undefined for nonsense", () => {
    expect(__testables.parseCount("banana")).toBeUndefined();
    expect(__testables.parseCount(undefined)).toBeUndefined();
  });
});

describe("buildFeedFields", () => {
  test("passes bags + per-bag weight through without computing the total", () => {
    const fields = buildFeedFields(
      intentWith({
        bags: { value: "4" },
        bagWeight: { value: "50" },
        feedType: {
          value: "layers",
          resolutions: {
            resolutionsPerAuthority: [
              { values: [{ value: { name: "chicken" } }] },
            ],
          },
        },
        cost: { value: "60" },
        date: { value: "2026-06-21" },
      }),
    );
    expect(fields).toEqual({
      bags: 4,
      bagWeightLbs: 50,
      feedType: "chicken",
      cost: 60,
      date: "2026-06-21",
    });
  });

  test("omits optional cost and date when absent", () => {
    const fields = buildFeedFields(
      intentWith({
        bags: { value: "2" },
        bagWeight: { value: "40" },
        feedType: { value: "goat" },
      }),
    );
    expect(fields).toEqual({ bags: 2, bagWeightLbs: 40, feedType: "goat" });
  });
});

describe("buildEggFields", () => {
  test("maps a dozen to 12", () => {
    expect(buildEggFields(intentWith({ count: { value: "a dozen" } }))).toEqual({
      count: 12,
    });
  });
  test("includes date and coop when present", () => {
    const fields = buildEggFields(
      intentWith({
        count: { value: "9" },
        date: { value: "2026-06-20" },
        coop: { value: "north coop" },
      }),
    );
    expect(fields).toEqual({ count: 9, date: "2026-06-20", coop: "north coop" });
  });
});

describe("buildBirthFields", () => {
  test("maps species, count, dam, sire, and date", () => {
    const fields = buildBirthFields(
      intentWith({
        species: { value: "goat" },
        count: { value: "2" },
        dam: { value: "Daisy" },
        sire: { value: "Max" },
        date: { value: "2026-06-21" },
      }),
    );
    expect(fields).toEqual({
      species: "goat",
      count: 2,
      dam: "Daisy",
      sire: "Max",
      date: "2026-06-21",
    });
  });

  test("drops an invalid date", () => {
    const fields = buildBirthFields(
      intentWith({ species: { value: "cow" }, date: { value: "yesterday" } }),
    );
    expect(fields.date).toBeUndefined();
    expect(fields.species).toBe("cow");
  });
});

describe("buildDeathFields", () => {
  test("maps animalRef, cause, and date", () => {
    expect(
      buildDeathFields(
        intentWith({
          animalRef: { value: "Bessie" },
          cause: { value: "illness" },
          date: { value: "2026-06-19" },
        }),
      ),
    ).toEqual({ animalRef: "Bessie", cause: "illness", date: "2026-06-19" });
  });
});

describe("buildMoveFields", () => {
  test("maps group, pasture, and date", () => {
    expect(
      buildMoveFields(
        intentWith({
          group: { value: "the goats" },
          pasture: { value: "south field" },
          date: { value: "2026-06-21" },
        }),
      ),
    ).toEqual({ group: "the goats", pasture: "south field", date: "2026-06-21" });
  });
});

describe("buildFeedUsageFields", () => {
  test("defaults to pounds when no unit is given", () => {
    const fields = buildFeedUsageFields(
      intentWith({
        feedType: {
          value: "layers",
          resolutions: {
            resolutionsPerAuthority: [
              { values: [{ value: { name: "chicken" } }] },
            ],
          },
        },
        amount: { value: "25" },
        date: { value: "2026-06-21" },
      }),
    );
    expect(fields).toEqual({ feedType: "chicken", lbs: 25, date: "2026-06-21" });
  });

  test("converts kilograms to pounds", () => {
    const fields = buildFeedUsageFields(
      intentWith({
        feedType: { value: "goat" },
        amount: { value: "10" },
        unit: { value: "kilograms" },
      }),
    );
    expect(fields.feedType).toBe("goat");
    expect(fields.lbs).toBeCloseTo(22.05, 2);
  });

  test("converts tons to pounds", () => {
    const fields = buildFeedUsageFields(
      intentWith({
        feedType: { value: "cattle" },
        amount: { value: "1" },
        unit: { value: "ton" },
      }),
    );
    expect(fields).toEqual({ feedType: "cattle", lbs: 2000 });
  });

  test("partial intent omits amount when absent", () => {
    const fields = buildFeedUsageFields(
      intentWith({ feedType: { value: "chicken" } }),
    );
    expect(fields).toEqual({ feedType: "chicken" });
  });

  test("drops an invalid date", () => {
    const fields = buildFeedUsageFields(
      intentWith({
        feedType: { value: "hay" },
        amount: { value: "50" },
        date: { value: "tomorrow" },
      }),
    );
    expect(fields).toEqual({ feedType: "hay", lbs: 50 });
  });
});

describe("buildPeriodQuery", () => {
  test("returns the period when present", () => {
    expect(buildPeriodQuery(intentWith({ period: { value: "this week" } }))).toEqual(
      { period: "this week" },
    );
  });
  test("empty object when absent", () => {
    expect(buildPeriodQuery(intentWith({}))).toEqual({});
  });
});

describe("buildEggCostQuery", () => {
  test("includes an optional flock alongside the period", () => {
    expect(
      buildEggCostQuery(
        intentWith({
          period: { value: "this month" },
          flock: { value: "north coop" },
        }),
      ),
    ).toEqual({ period: "this month", flock: "north coop" });
  });
  test("flock only", () => {
    expect(
      buildEggCostQuery(intentWith({ flock: { value: "south" } })),
    ).toEqual({ flock: "south" });
  });
  test("empty object when neither is present", () => {
    expect(buildEggCostQuery(intentWith({}))).toEqual({});
  });
});

describe("buildHealthExpenseFields", () => {
  test("maps category, cost, animalRef, and date", () => {
    const fields = buildHealthExpenseFields(
      intentWith({
        category: {
          value: "vet bill",
          resolutions: {
            resolutionsPerAuthority: [{ values: [{ value: { name: "vet" } }] }],
          },
        },
        cost: { value: "60" },
        animalRef: { value: "Bessie" },
        date: { value: "2026-06-21" },
      }),
    );
    expect(fields).toEqual({
      category: "vet",
      cost: 60,
      animalRef: "Bessie",
      date: "2026-06-21",
    });
  });

  test("omits optional animalRef and date when absent", () => {
    const fields = buildHealthExpenseFields(
      intentWith({ category: { value: "medicine" }, cost: { value: "25" } }),
    );
    expect(fields).toEqual({ category: "medicine", cost: 25 });
  });

  test("drops an invalid date", () => {
    const fields = buildHealthExpenseFields(
      intentWith({
        category: { value: "supplies" },
        cost: { value: "12" },
        date: { value: "yesterday" },
      }),
    );
    expect(fields.date).toBeUndefined();
    expect(fields).toEqual({ category: "supplies", cost: 12 });
  });
});

describe("buildMilkFields", () => {
  test("defaults to gallons when no unit is given", () => {
    const fields = buildMilkFields(
      intentWith({
        volume: { value: "2" },
        animal: { value: "Daisy" },
        date: { value: "2026-06-21" },
      }),
    );
    expect(fields).toEqual({
      volume: 2,
      unit: "gal",
      animal: "Daisy",
      date: "2026-06-21",
    });
  });

  test("normalizes the spoken unit", () => {
    const fields = buildMilkFields(
      intentWith({ volume: { value: "4" }, unit: { value: "quarts" } }),
    );
    expect(fields).toEqual({ volume: 4, unit: "qt" });
  });

  test("omits volume + unit when no volume is given", () => {
    expect(
      buildMilkFields(intentWith({ animal: { value: "Daisy" } })),
    ).toEqual({ animal: "Daisy" });
  });

  test("drops an invalid date", () => {
    const fields = buildMilkFields(
      intentWith({ volume: { value: "3" }, date: { value: "tomorrow" } }),
    );
    expect(fields).toEqual({ volume: 3, unit: "gal" });
  });
});

describe("buildWithinDays", () => {
  test("returns a positive integer when present", () => {
    expect(buildWithinDays(intentWith({ withinDays: { value: "7" } }))).toBe(7);
  });
  test("undefined when absent or non-positive", () => {
    expect(buildWithinDays(intentWith({}))).toBeUndefined();
    expect(
      buildWithinDays(intentWith({ withinDays: { value: "0" } })),
    ).toBeUndefined();
    expect(
      buildWithinDays(intentWith({ withinDays: { value: "soon" } })),
    ).toBeUndefined();
  });
});

describe("buildCareTaskRef", () => {
  test("returns the trimmed task slot", () => {
    expect(
      buildCareTaskRef(intentWith({ task: { value: "deworm the goats" } })),
    ).toBe("deworm the goats");
  });
  test("undefined when absent", () => {
    expect(buildCareTaskRef(intentWith({}))).toBeUndefined();
  });
});

describe("normalizeHarvestUnit", () => {
  test("maps spoken units to canonical tokens", () => {
    expect(__testables.normalizeHarvestUnit("pounds")).toBe("lb");
    expect(__testables.normalizeHarvestUnit("Ounces")).toBe("oz");
    expect(__testables.normalizeHarvestUnit("bunches")).toBe("bunch");
    expect(__testables.normalizeHarvestUnit("baskets")).toBe("basket");
  });
  test("returns undefined for unknown units", () => {
    expect(__testables.normalizeHarvestUnit("scoops")).toBeUndefined();
  });
});

describe("buildHarvestFields", () => {
  test("defaults to pounds when no unit is given", () => {
    const fields = buildHarvestFields(
      intentWith({
        crop: {
          value: "cherry tomatoes",
          resolutions: {
            resolutionsPerAuthority: [
              { values: [{ value: { name: "tomatoes" } }] },
            ],
          },
        },
        quantity: { value: "5" },
        date: { value: "2026-06-21" },
      }),
    );
    expect(fields).toEqual({
      crop: "tomatoes",
      quantity: 5,
      unit: "lb",
      date: "2026-06-21",
    });
  });

  test("normalizes the spoken unit", () => {
    const fields = buildHarvestFields(
      intentWith({
        crop: { value: "kale" },
        quantity: { value: "3" },
        unit: { value: "bunches" },
      }),
    );
    expect(fields).toEqual({ crop: "kale", quantity: 3, unit: "bunch" });
  });

  test("omits quantity + unit when no quantity is given", () => {
    expect(
      buildHarvestFields(intentWith({ crop: { value: "squash" } })),
    ).toEqual({ crop: "squash" });
  });

  test("drops an invalid date", () => {
    const fields = buildHarvestFields(
      intentWith({
        crop: { value: "beans" },
        quantity: { value: "2" },
        date: { value: "tomorrow" },
      }),
    );
    expect(fields).toEqual({ crop: "beans", quantity: 2, unit: "lb" });
  });
});
