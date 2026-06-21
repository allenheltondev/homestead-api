// APL helper: renders visual screens on Echo Show / Fire TV and other
// APL-capable devices, and no-ops on headless Echo devices so the spoken
// response is identical everywhere. Datasource builders are pure so they
// unit-test without the ask-sdk.

import {
  herdScreenDocument,
  confirmationDocument,
  homeDocument,
} from "../apl/documents.mjs";

const APL_INTERFACE = "Alexa.Presentation.APL";

export function supportsApl(handlerInput) {
  const interfaces =
    handlerInput?.requestEnvelope?.context?.System?.device?.supportedInterfaces;
  return Boolean(interfaces && interfaces[APL_INTERFACE]);
}

// Adds a RenderDocument directive only on APL devices; returns the
// responseBuilder either way so callers can chain .speak().getResponse().
function render(handlerInput, token, document, datasources) {
  const rb = handlerInput.responseBuilder;
  if (!supportsApl(handlerInput)) return rb;
  return rb.addDirective({
    type: "Alexa.Presentation.APL.RenderDocument",
    token,
    document,
    datasources,
  });
}

function capitalize(value) {
  const text = String(value ?? "");
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function money(amount) {
  const value = Number(amount) || 0;
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function friendlyDate(now) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}

// GET /stats/summary -> herd screen datasource.
export function buildSummaryData(summary, now = new Date()) {
  const herd = summary?.herd ?? {};
  const bySpecies = Array.isArray(herd.bySpecies) ? herd.bySpecies : [];
  const total = herd.totalAnimals ?? 0;
  const births = summary?.births?.thisMonth ?? 0;
  const deaths = summary?.deaths?.thisMonth ?? 0;
  const feed = summary?.feed?.thisMonthSpend ?? 0;
  return {
    title: "Herd Summary",
    subtitle: friendlyDate(now),
    total: plural(total, "animal"),
    species: bySpecies.map((s) => ({
      name: capitalize(s.species ?? "animal"),
      count: String(s.active ?? s.total ?? 0),
    })),
    footer: [
      plural(births, "birth"),
      plural(deaths, "death"),
      `${money(feed)} feed`,
    ],
  };
}

// GET /stats/herd -> herd screen datasource.
export function buildHerdData(herd, now = new Date()) {
  const total = herd?.total ?? 0;
  const active = herd?.byStatus?.active ?? 0;
  const entries = Object.entries(herd?.bySpecies ?? {});
  return {
    title: "Herd Count",
    subtitle: friendlyDate(now),
    total: plural(total, "animal"),
    species: entries.map(([name, s]) => ({
      name: capitalize(name),
      count: String(s?.total ?? 0),
    })),
    footer: [`${active} active`, `${entries.length} species`, ""],
  };
}

export function buildConfirmationData(title, message) {
  return { title, message: message ?? "" };
}

export function addHomeScreen(handlerInput) {
  return render(handlerInput, "home", homeDocument, {
    homestead: {
      title: "Homestead",
      subtitle: "Your herd at a glance",
      hints: [
        "“Ask Homestead for my herd summary”",
        "“How many animals do I have?”",
        "“Record a birth”  ·  “Record a feed purchase”",
      ],
    },
  });
}

export function addHerdSummaryScreen(handlerInput, summary, now) {
  return render(handlerInput, "herd-summary", herdScreenDocument, {
    homestead: buildSummaryData(summary, now),
  });
}

export function addHerdCountScreen(handlerInput, herd, now) {
  return render(handlerInput, "herd-count", herdScreenDocument, {
    homestead: buildHerdData(herd, now),
  });
}

export function addConfirmationScreen(handlerInput, title, message) {
  return render(handlerInput, "confirmation", confirmationDocument, {
    confirmation: buildConfirmationData(title, message),
  });
}
