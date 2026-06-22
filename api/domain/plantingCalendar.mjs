// Local seasonal planting calendar. A tiny static table keyed by USDA-style
// hardiness zone -> per-crop "start indoors / direct sow / transplant" month
// windows (1-12). This is intentionally a small curated dataset (no Scans, no
// DynamoDB) so the calendar endpoint works offline; optional GRN /catalog/crops
// enrichment is layered on best-effort by the route when GRN is configured.
//
// Month windows are inclusive ranges of month numbers (1 = Jan ... 12 = Dec).
// Zones we don't have curated data for fall back to the temperate "7" profile.

const CALENDARS = {
  5: [
    { crop: "tomato", startIndoors: [3, 4], transplant: [5, 6], directSow: null, harvest: [7, 9] },
    { crop: "lettuce", startIndoors: [3, 3], transplant: [4, 5], directSow: [4, 8], harvest: [5, 10] },
    { crop: "peas", startIndoors: null, transplant: null, directSow: [4, 5], harvest: [6, 7] },
    { crop: "carrot", startIndoors: null, transplant: null, directSow: [5, 7], harvest: [7, 10] },
    { crop: "squash", startIndoors: [4, 5], transplant: [6, 6], directSow: [6, 6], harvest: [8, 9] },
    { crop: "garlic", startIndoors: null, transplant: null, directSow: [10, 10], harvest: [7, 7] },
  ],
  7: [
    { crop: "tomato", startIndoors: [2, 3], transplant: [4, 5], directSow: null, harvest: [6, 9] },
    { crop: "lettuce", startIndoors: [2, 2], transplant: [3, 4], directSow: [3, 9], harvest: [4, 11] },
    { crop: "peas", startIndoors: null, transplant: null, directSow: [2, 4], harvest: [5, 6] },
    { crop: "carrot", startIndoors: null, transplant: null, directSow: [3, 8], harvest: [6, 11] },
    { crop: "squash", startIndoors: [3, 4], transplant: [5, 5], directSow: [5, 6], harvest: [7, 9] },
    { crop: "garlic", startIndoors: null, transplant: null, directSow: [10, 11], harvest: [6, 7] },
    { crop: "pepper", startIndoors: [2, 3], transplant: [5, 5], directSow: null, harvest: [7, 10] },
  ],
  9: [
    { crop: "tomato", startIndoors: [1, 2], transplant: [3, 4], directSow: null, harvest: [5, 11] },
    { crop: "lettuce", startIndoors: [10, 11], transplant: [11, 1], directSow: [10, 2], harvest: [12, 4] },
    { crop: "peas", startIndoors: null, transplant: null, directSow: [11, 1], harvest: [2, 4] },
    { crop: "carrot", startIndoors: null, transplant: null, directSow: [9, 2], harvest: [12, 5] },
    { crop: "squash", startIndoors: [2, 3], transplant: [3, 4], directSow: [3, 4], harvest: [6, 9] },
    { crop: "pepper", startIndoors: [1, 2], transplant: [3, 4], directSow: null, harvest: [6, 11] },
  ],
};

const DEFAULT_ZONE = "7";

// The set of zones we have curated calendars for.
export function knownZones() {
  return Object.keys(CALENDARS);
}

// Resolves a zone string to a curated calendar, falling back to the temperate
// default profile. Returns { zone, requestedZone, fallback, crops }.
export function gardenCalendar(zone) {
  const requestedZone = zone === undefined || zone === null || zone === "" ? DEFAULT_ZONE : String(zone).trim();
  const resolvedZone = CALENDARS[requestedZone] ? requestedZone : DEFAULT_ZONE;
  const fallback = resolvedZone !== requestedZone;

  const crops = CALENDARS[resolvedZone].map((c) => ({
    crop: c.crop,
    startIndoors: monthRange(c.startIndoors),
    transplant: monthRange(c.transplant),
    directSow: monthRange(c.directSow),
    harvest: monthRange(c.harvest),
  }));

  return { zone: resolvedZone, requestedZone, fallback, crops };
}

// Shapes a [start, end] inclusive month-number range into a labeled object, or
// null when the activity does not apply to the crop in this zone.
function monthRange(range) {
  if (!range) return null;
  const [start, end] = range;
  return { startMonth: start, endMonth: end };
}
