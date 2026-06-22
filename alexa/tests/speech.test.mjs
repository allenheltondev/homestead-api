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
  renderHealthExpenseLogged,
  renderHealthStats,
  renderMortality,
  renderDigest,
  renderMilkLogged,
  renderMilkStats,
  renderCareDue,
  renderUpcomingDue,
  renderPnl,
  renderHarvestLogged,
  renderGardenStats,
  renderSurplusPublished,
  renderGrnListings,
  renderGrnRequests,
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

describe("renderHealthExpenseLogged", () => {
  test("reads back the amount and category", () => {
    const speech = renderHealthExpenseLogged({ category: "vet", cost: 60 });
    expect(speech).toContain("60 dollars");
    expect(speech).toContain("vet expense");
  });

  test("singular dollar", () => {
    expect(renderHealthExpenseLogged({ category: "medicine", cost: 1 })).toContain(
      "1 dollar medicine expense",
    );
  });

  test("falls back without a cost", () => {
    expect(renderHealthExpenseLogged({ category: "supplies" })).toMatch(
      /supplies expense/,
    );
  });

  test("null payload", () => {
    expect(renderHealthExpenseLogged(null)).toMatch(/recorded that health expense/);
  });
});

describe("renderHealthStats", () => {
  test("speaks the total spend and a category breakdown", () => {
    const speech = renderHealthStats({
      total: 150,
      periodLabel: "this month",
      byCategory: [
        { category: "vet", cost: 90 },
        { category: "medicine", cost: 60 },
      ],
    });
    expect(speech).toContain("150 dollars on animal health this month");
    expect(speech).toContain("90 dollars on vet");
    expect(speech).toContain("60 dollars on medicine");
  });

  test("handles no spend", () => {
    expect(renderHealthStats({ total: 0 })).toMatch(/haven't spent anything/);
  });

  test("null payload", () => {
    expect(renderHealthStats(null)).toMatch(/couldn't read/);
  });
});

describe("renderMortality", () => {
  test("speaks deaths and a fractional loss rate", () => {
    const speech = renderMortality({
      deaths: 2,
      lossRate: 0.04,
      periodLabel: "this year",
    });
    expect(speech).toContain("2 animals this year");
    expect(speech).toContain("4 percent loss rate");
  });

  test("accepts an already-percentage rate", () => {
    const speech = renderMortality({ deaths: 1, lossRate: 5 });
    expect(speech).toContain("5 percent loss rate");
  });

  test("celebrates zero losses", () => {
    expect(renderMortality({ deaths: 0 })).toMatch(/haven't lost any animals/);
  });

  test("null payload", () => {
    expect(renderMortality(null)).toMatch(/couldn't read/);
  });
});

describe("renderDigest", () => {
  test("speaks the API-supplied lines after an intro", () => {
    const speech = renderDigest({
      title: "Your weekly digest",
      lines: ["You collected 84 eggs.", "You spent 40 dollars on feed."],
    });
    expect(speech).toContain("Your weekly digest");
    expect(speech).toContain("You collected 84 eggs.");
    expect(speech).toContain("You spent 40 dollars on feed.");
  });

  test("handles an empty digest", () => {
    expect(renderDigest({ lines: [] })).toMatch(/nothing to report/);
  });

  test("null payload", () => {
    expect(renderDigest(null)).toMatch(/couldn't put together/);
  });
});

describe("renderMilkLogged", () => {
  test("speaks volume, unit, and animal", () => {
    expect(
      renderMilkLogged({ volume: 2, unit: "gal", animal: "Daisy" }),
    ).toBe("Got it. I logged 2 gallons of milk from Daisy.");
  });
  test("singular volume and no animal", () => {
    expect(renderMilkLogged({ volume: 1, unit: "qt" })).toBe(
      "Got it. I logged 1 quart of milk.",
    );
  });
  test("falls back without a volume", () => {
    expect(renderMilkLogged({})).toMatch(/logged that milking/);
    expect(renderMilkLogged(null)).toMatch(/logged that milking/);
  });
});

describe("renderMilkStats", () => {
  test("speaks total and per-day rate", () => {
    const speech = renderMilkStats({
      total: 14,
      unit: "gal",
      perDay: 0.5,
      periodLabel: "this month",
    });
    expect(speech).toContain("14 gallons of milk this month");
    expect(speech).toContain("a day");
  });
  test("appends a store comparison when cost is present", () => {
    const speech = renderMilkStats({
      total: 10,
      costPerGallon: 3,
      storePricePerGallon: 5,
    });
    expect(speech).toContain("cheaper than the $5 store price");
  });
  test("nothing collected", () => {
    expect(renderMilkStats({ total: 0 })).toMatch(/haven't collected any milk/);
  });
  test("null payload", () => {
    expect(renderMilkStats(null)).toMatch(/couldn't read your milk stats/);
  });
});

describe("renderCareDue", () => {
  test("lists tasks with due dates", () => {
    const speech = renderCareDue({
      tasks: [
        { name: "deworm the goats", dueDate: "2026-06-26" },
        { name: "trim hooves", dueDate: "2026-06-27" },
      ],
    });
    expect(speech).toContain("2 care tasks coming due");
    expect(speech).toContain("deworm the goats on");
  });
  test("summarizes the overflow beyond three", () => {
    const speech = renderCareDue({
      tasks: [
        { name: "a" },
        { name: "b" },
        { name: "c" },
        { name: "d" },
        { name: "e" },
      ],
    });
    expect(speech).toContain("2 other tasks");
  });
  test("nothing due", () => {
    expect(renderCareDue({ tasks: [] })).toMatch(/don't have any care tasks/);
  });
  test("null payload", () => {
    expect(renderCareDue(null)).toMatch(/couldn't read your care schedule/);
  });
});

describe("renderUpcomingDue", () => {
  test("speaks births and hatches", () => {
    const speech = renderUpcomingDue({
      breeding: { upcoming: [{ dam: "Daisy", event: "kidding", dueDate: "2026-07-01" }] },
      incubation: { batches: [{ species: "chicken", eggCount: 12, hatchDate: "2026-06-30" }] },
    });
    expect(speech).toContain("Daisy");
    expect(speech).toContain("In the incubator");
    expect(speech).toContain("chicken egg");
  });
  test("nothing due", () => {
    expect(
      renderUpcomingDue({ breeding: { upcoming: [] }, incubation: { batches: [] } }),
    ).toMatch(/Nothing is due/);
  });
  test("null payload", () => {
    expect(renderUpcomingDue(null)).toMatch(/couldn't check what's coming due/);
  });
});

describe("renderPnl", () => {
  test("in the black", () => {
    expect(
      renderPnl({ income: 400, expenses: 250, net: 150, periodLabel: "this month" }),
    ).toBe(
      "This month you brought in 400 dollars and spent 250 dollars, so you're in the black by 150 dollars.",
    );
  });
  test("in the red", () => {
    expect(renderPnl({ income: 100, expenses: 250 })).toContain(
      "in the red by 150 dollars",
    );
  });
  test("broke even", () => {
    expect(renderPnl({ income: 100, expenses: 100 })).toContain("broke even");
  });
  test("null payload", () => {
    expect(renderPnl(null)).toMatch(/couldn't read your profit and loss/);
  });
});

describe("renderHarvestLogged", () => {
  test("speaks quantity, unit, and crop", () => {
    expect(
      renderHarvestLogged({ crop: "tomatoes", quantity: 5, unit: "lb" }),
    ).toBe("Got it. I logged 5 pounds of tomatoes.");
  });
  test("singular and a non-weight unit reads naturally", () => {
    expect(
      renderHarvestLogged({ crop: "kale", quantity: 1, unit: "bunch" }),
    ).toBe("Got it. I logged 1 bunch of kale.");
  });
  test("falls back without a quantity", () => {
    expect(renderHarvestLogged({ crop: "squash" })).toMatch(/squash harvest/);
    expect(renderHarvestLogged(null)).toMatch(/logged that harvest/);
  });
});

describe("renderGardenStats", () => {
  test("speaks total and a top-crop breakdown", () => {
    const speech = renderGardenStats({
      total: 40,
      unit: "lb",
      periodLabel: "this month",
      byCrop: [
        { crop: "tomatoes", quantity: 18 },
        { crop: "squash", quantity: 12 },
      ],
    });
    expect(speech).toContain("40 pounds from the garden this month");
    expect(speech).toContain("18 pounds of tomatoes");
    expect(speech).toContain("12 pounds of squash");
  });
  test("nothing harvested", () => {
    expect(renderGardenStats({ total: 0 })).toMatch(/haven't harvested anything/);
  });
  test("null payload", () => {
    expect(renderGardenStats(null)).toMatch(/couldn't read your garden stats/);
  });
});

describe("renderSurplusPublished", () => {
  test("confirms what was shared", () => {
    expect(
      renderSurplusPublished({ crop: "tomatoes", quantity: 3, unit: "lb" }),
    ).toBe(
      "Done. I shared 3 pounds of tomatoes with the Good Roots Network.",
    );
  });
  test("falls back without a quantity", () => {
    expect(renderSurplusPublished({ crop: "kale" })).toMatch(
      /shared your kale with the Good Roots Network/,
    );
    expect(renderSurplusPublished(null)).toMatch(/shared your surplus/);
  });
});

describe("renderGrnListings", () => {
  test("speaks claim status per listing", () => {
    const speech = renderGrnListings({
      listings: [
        { crop: "tomatoes", quantity: 5, unit: "lb", claimedBy: "Maria" },
        { crop: "squash", quantity: 3, unit: "lb", status: "available" },
      ],
    });
    expect(speech).toContain("2 listings on the Good Roots Network");
    expect(speech).toContain("claimed by Maria");
    expect(speech).toContain("still available");
  });
  test("summarizes overflow beyond three", () => {
    const speech = renderGrnListings({
      listings: [
        { crop: "a" },
        { crop: "b" },
        { crop: "c" },
        { crop: "d" },
      ],
    });
    expect(speech).toContain("1 other listing");
  });
  test("no listings", () => {
    expect(renderGrnListings({ listings: [] })).toMatch(
      /don't have any listings/,
    );
  });
  test("null payload", () => {
    expect(renderGrnListings(null)).toMatch(
      /couldn't read your Good Roots Network listings/,
    );
  });
});

describe("renderGrnRequests", () => {
  test("speaks what the community needs", () => {
    const speech = renderGrnRequests({
      requests: [{ item: "eggs" }, { item: "fresh herbs" }],
    });
    expect(speech).toContain("2 things");
    expect(speech).toContain("eggs");
    expect(speech).toContain("fresh herbs");
  });
  test("summarizes overflow beyond three", () => {
    const speech = renderGrnRequests({
      requests: [{ item: "a" }, { item: "b" }, { item: "c" }, { item: "d" }],
    });
    expect(speech).toContain("1 more");
  });
  test("nothing requested", () => {
    expect(renderGrnRequests({ requests: [] })).toMatch(/isn't asking for anything/);
  });
  test("null payload", () => {
    expect(renderGrnRequests(null)).toMatch(/couldn't read the community's requests/);
  });
});
