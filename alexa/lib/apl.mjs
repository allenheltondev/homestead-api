// APL helpers for the Homestead skill. Each `add*Screen` function gates on the
// device's `Alexa.Presentation.APL` interface so the skill stays
// voice-only on headless devices (Echo Dot, phone) and adds a visual screen
// only where it's supported. The datasource builders are pure so they can be
// unit-tested without ask-sdk.

import {
  eggStatsDocument,
  eggCostDocument,
  COLORS,
} from "../apl/documents.mjs";

// True when the requesting device supports APL. Reads the supported-interfaces
// map off the request envelope, the same gate the rest of the skill uses.
export function supportsApl(handlerInput) {
  const interfaces =
    handlerInput?.requestEnvelope?.context?.System?.device
      ?.supportedInterfaces ?? {};
  return Boolean(interfaces["Alexa.Presentation.APL"]);
}

// Adds a RenderDocument directive to the response builder. No-op (returns the
// builder unchanged) when the device can't render APL.
function renderDocument(handlerInput, token, document, datasources) {
  if (!supportsApl(handlerInput)) return handlerInput.responseBuilder;
  return handlerInput.responseBuilder.addDirective({
    type: "Alexa.Presentation.APL.RenderDocument",
    token,
    document,
    datasources,
  });
}

// Pure datasource builder for the egg-stats screen.
export function buildEggStatsDatasource(stats) {
  const count = stats?.count ?? 0;
  const dozens = stats?.dozens ?? Math.floor(count / 12);
  const perDay =
    stats?.perDay != null && Number.isFinite(Number(stats.perDay))
      ? Math.round(Number(stats.perDay))
      : 0;
  return {
    data: {
      title: "Egg Collection",
      subtitle: stats?.periodLabel ?? "this month",
      stats: [
        { label: "eggs", value: String(count) },
        { label: "dozen", value: String(dozens) },
        { label: "per day", value: String(perDay) },
      ],
    },
  };
}

// Pure datasource builder for the egg-cost screen, including the cheaper /
// more-expensive badge.
export function buildEggCostDatasource(cost) {
  const perDozen = Number(cost?.costPerDozen);
  const storePrice = Number(cost?.storePricePerDozen);
  const fmt = (v) =>
    Number.isFinite(v) ? (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`) : "—";

  let badge = { text: "no comparison", color: COLORS.surface };
  if (Number.isFinite(perDozen) && Number.isFinite(storePrice)) {
    if (perDozen < storePrice) {
      badge = { text: "Cheaper than store", color: COLORS.cheaper };
    } else if (perDozen > storePrice) {
      badge = { text: "Pricier than store", color: COLORS.expensive };
    } else {
      badge = { text: "Same as store", color: COLORS.surface };
    }
  }

  return {
    data: {
      title: "Egg Cost",
      subtitle: cost?.periodLabel ?? "this month",
      stats: [
        { label: "your cost / dozen", value: fmt(perDozen) },
        { label: "store / dozen", value: fmt(storePrice) },
      ],
      badge,
    },
  };
}

// Attaches the egg-stats screen to the response (when supported).
export function addEggStatsScreen(handlerInput, stats) {
  return renderDocument(
    handlerInput,
    "eggStatsToken",
    eggStatsDocument,
    buildEggStatsDatasource(stats),
  );
}

// Attaches the egg-cost screen to the response (when supported).
export function addEggCostScreen(handlerInput, cost) {
  return renderDocument(
    handlerInput,
    "eggCostToken",
    eggCostDocument,
    buildEggCostDatasource(cost),
  );
}
