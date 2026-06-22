import { gardenCalendar, knownZones } from "../../api/domain/plantingCalendar.mjs";

describe("gardenCalendar", () => {
  test("returns curated crops for a known zone", () => {
    const cal = gardenCalendar("7");
    expect(cal.zone).toBe("7");
    expect(cal.fallback).toBe(false);
    expect(cal.crops.length).toBeGreaterThan(0);
    const tomato = cal.crops.find((c) => c.crop === "tomato");
    expect(tomato.transplant).toEqual({ startMonth: 4, endMonth: 5 });
  });

  test("falls back to the default zone for an unknown zone", () => {
    const cal = gardenCalendar("99");
    expect(cal.requestedZone).toBe("99");
    expect(cal.zone).toBe("7");
    expect(cal.fallback).toBe(true);
  });

  test("defaults the zone when none is supplied", () => {
    const cal = gardenCalendar();
    expect(cal.zone).toBe("7");
  });

  test("null activities surface as null", () => {
    const cal = gardenCalendar("7");
    const peas = cal.crops.find((c) => c.crop === "peas");
    expect(peas.startIndoors).toBeNull();
    expect(peas.directSow).not.toBeNull();
  });

  test("knownZones lists the curated zones", () => {
    expect(knownZones()).toEqual(expect.arrayContaining(["5", "7", "9"]));
  });
});
