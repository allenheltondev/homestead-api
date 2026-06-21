import {
  slotValue,
  buildBirthFields,
  buildFeedFields,
  __testables,
} from "../lib/slots.mjs";

function intentWith(slots) {
  return { name: "X", slots };
}

describe("slotValue", () => {
  test("prefers entity-resolution canonical value", () => {
    const intent = intentWith({
      sex: {
        value: "girl",
        resolutions: {
          resolutionsPerAuthority: [{ values: [{ value: { name: "female" } }] }],
        },
      },
    });
    expect(slotValue(intent, "sex")).toBe("female");
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

describe("buildBirthFields", () => {
  test("requires species", () => {
    const result = buildBirthFields(intentWith({}));
    expect(result.ok).toBe(false);
    expect(result.reprompt).toMatch(/species/i);
  });

  test("maps species plus optional fields", () => {
    const result = buildBirthFields(
      intentWith({
        species: { value: "goat" },
        name: { value: "Daisy" },
        sex: { value: "female" },
        dob: { value: "2026-06-21" },
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.fields).toEqual({
      species: "goat",
      name: "Daisy",
      sex: "female",
      dob: "2026-06-21",
    });
  });

  test("drops an invalid dob", () => {
    const result = buildBirthFields(
      intentWith({ species: { value: "cow" }, dob: { value: "yesterday" } }),
    );
    expect(result.ok).toBe(true);
    expect(result.fields.dob).toBeUndefined();
  });
});

describe("buildFeedFields", () => {
  test("maps a complete feed purchase", () => {
    const result = buildFeedFields(
      intentWith({
        type: { value: "hay" },
        quantity: { value: "10" },
        unit: { value: "bales" },
        cost: { value: "80" },
        vendor: { value: "Tractor Supply" },
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.fields).toEqual({
      type: "hay",
      quantity: 10,
      unit: "bale",
      cost: 80,
      vendor: "Tractor Supply",
    });
  });

  test("defaults vendor to unknown", () => {
    const result = buildFeedFields(
      intentWith({
        type: { value: "grain" },
        quantity: { value: "5" },
        unit: { value: "bag" },
        cost: { value: "30" },
      }),
    );
    expect(result.fields.vendor).toBe("unknown");
  });

  test("reprompts on missing type", () => {
    expect(buildFeedFields(intentWith({})).ok).toBe(false);
  });

  test("reprompts on non-positive quantity", () => {
    const result = buildFeedFields(
      intentWith({
        type: { value: "hay" },
        quantity: { value: "0" },
        unit: { value: "bale" },
        cost: { value: "10" },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.reprompt).toMatch(/quantity/i);
  });

  test("reprompts on unknown unit", () => {
    const result = buildFeedFields(
      intentWith({
        type: { value: "hay" },
        quantity: { value: "3" },
        unit: { value: "scoops" },
        cost: { value: "10" },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.reprompt).toMatch(/unit/i);
  });
});
