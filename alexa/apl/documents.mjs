// APL (Alexa Presentation Language) documents for screen devices (Echo
// Show, Fire TV, etc). Authored as JS objects so they bundle inline with
// esbuild and load under jest without JSON import-attribute concerns.
//
// The skill only sends these on devices that report APL support; on
// headless Echo devices the spoken response is unaffected.
//
// This module is the UNION of the herd visuals (home / herd summary /
// confirmation) and the egg visuals (egg stats / egg cost). Both sets share
// a single dark "homestead green" palette defined below.

// Shared dark "homestead green" palette. The herd documents reference these
// values through an APL `resources` block (`@colorBackground`, ...), while the
// egg documents inline the hex values directly. `COLORS` exposes friendly
// aliases (including the cost-badge colors) for the lib datasource builders.
export const COLORS = {
  background: "#15281d",
  surface: "#1f3a2b",
  primary: "#8fd19e",
  accent: "#8fd19e",
  text: "#f4f7f4",
  muted: "#aebcb0",
  cheaper: "#3fa66a",
  expensive: "#c0563f",
};

// The `resources` shape the herd documents expect (`@colorX` lookups).
const colors = {
  colorBackground: COLORS.background,
  colorSurface: COLORS.surface,
  colorAccent: COLORS.accent,
  colorText: COLORS.text,
  colorMuted: COLORS.muted,
};

function background() {
  return {
    type: "Frame",
    position: "absolute",
    width: "100vw",
    height: "100vh",
    backgroundColor: "@colorBackground",
  };
}

// Herd summary / herd count share one layout: a title, a total, a
// scrollable list of species counts, and a 3-cell footer row. The footer
// strings differ per screen (births/deaths/feed vs active/species).
export const herdScreenDocument = {
  type: "APL",
  version: "2023.3",
  theme: "dark",
  resources: [{ colors }],
  mainTemplate: {
    parameters: ["payload"],
    items: [
      {
        type: "Container",
        width: "100vw",
        height: "100vh",
        items: [
          background(),
          {
            type: "Container",
            width: "100vw",
            height: "100vh",
            paddingLeft: "6vw",
            paddingRight: "6vw",
            paddingTop: "5vh",
            paddingBottom: "5vh",
            items: [
              {
                type: "Text",
                text: "${payload.homestead.title}",
                color: "@colorText",
                fontSize: "46dp",
                fontWeight: "700",
              },
              {
                type: "Text",
                text: "${payload.homestead.subtitle}",
                color: "@colorMuted",
                fontSize: "22dp",
                paddingBottom: "2vh",
              },
              {
                type: "Text",
                text: "${payload.homestead.total}",
                color: "@colorAccent",
                fontSize: "30dp",
                fontWeight: "600",
                paddingBottom: "1vh",
              },
              {
                type: "Sequence",
                grow: 1,
                width: "100%",
                data: "${payload.homestead.species}",
                scrollDirection: "vertical",
                item: {
                  type: "Container",
                  direction: "row",
                  alignItems: "center",
                  paddingTop: "1.2vh",
                  paddingBottom: "1.2vh",
                  items: [
                    {
                      type: "Text",
                      text: "${data.name}",
                      color: "@colorText",
                      fontSize: "26dp",
                      grow: 1,
                    },
                    {
                      type: "Text",
                      text: "${data.count}",
                      color: "@colorAccent",
                      fontSize: "26dp",
                      fontWeight: "700",
                    },
                  ],
                },
              },
              {
                type: "Container",
                direction: "row",
                width: "100%",
                paddingTop: "2vh",
                items: [
                  {
                    type: "Text",
                    text: "${payload.homestead.footer[0]}",
                    color: "@colorText",
                    fontSize: "22dp",
                    grow: 1,
                    textAlign: "center",
                  },
                  {
                    type: "Text",
                    text: "${payload.homestead.footer[1]}",
                    color: "@colorText",
                    fontSize: "22dp",
                    grow: 1,
                    textAlign: "center",
                  },
                  {
                    type: "Text",
                    text: "${payload.homestead.footer[2]}",
                    color: "@colorText",
                    fontSize: "22dp",
                    grow: 1,
                    textAlign: "center",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

// Centered confirmation card for record-birth / record-feed.
export const confirmationDocument = {
  type: "APL",
  version: "2023.3",
  theme: "dark",
  resources: [{ colors }],
  mainTemplate: {
    parameters: ["payload"],
    items: [
      {
        type: "Container",
        width: "100vw",
        height: "100vh",
        justifyContent: "center",
        alignItems: "center",
        items: [
          background(),
          {
            type: "Text",
            text: "✓",
            color: "@colorAccent",
            fontSize: "90dp",
            fontWeight: "700",
          },
          {
            type: "Text",
            text: "${payload.confirmation.title}",
            color: "@colorText",
            fontSize: "40dp",
            fontWeight: "700",
            textAlign: "center",
            paddingTop: "1vh",
          },
          {
            type: "Text",
            text: "${payload.confirmation.message}",
            color: "@colorMuted",
            fontSize: "26dp",
            textAlign: "center",
            paddingTop: "2vh",
            paddingLeft: "12vw",
            paddingRight: "12vw",
          },
        ],
      },
    ],
  },
};

// Launch / home screen with a title and a few spoken-command hints.
export const homeDocument = {
  type: "APL",
  version: "2023.3",
  theme: "dark",
  resources: [{ colors }],
  mainTemplate: {
    parameters: ["payload"],
    items: [
      {
        type: "Container",
        width: "100vw",
        height: "100vh",
        paddingLeft: "8vw",
        paddingRight: "8vw",
        paddingTop: "8vh",
        items: [
          background(),
          {
            type: "Text",
            text: "${payload.homestead.title}",
            color: "@colorText",
            fontSize: "54dp",
            fontWeight: "700",
          },
          {
            type: "Text",
            text: "${payload.homestead.subtitle}",
            color: "@colorAccent",
            fontSize: "26dp",
            paddingBottom: "3vh",
          },
          {
            type: "Sequence",
            grow: 1,
            width: "100%",
            data: "${payload.homestead.hints}",
            item: {
              type: "Text",
              text: "${data}",
              color: "@colorMuted",
              fontSize: "26dp",
              paddingTop: "1.4vh",
              paddingBottom: "1.4vh",
            },
          },
        ],
      },
    ],
  },
};

// A simple header + stat-tile layout shared by both egg screens. The
// datasource feeds title, subtitle, and an array of { label, value } stats.
function statScreen(extraItems = []) {
  return {
    type: "APL",
    version: "2024.2",
    theme: "dark",
    mainTemplate: {
      parameters: ["payload"],
      items: [
        {
          type: "Container",
          width: "100vw",
          height: "100vh",
          direction: "column",
          backgroundColor: COLORS.background,
          paddingLeft: "@spacingLarge",
          paddingRight: "@spacingLarge",
          paddingTop: "@spacingLarge",
          items: [
            {
              type: "Text",
              text: "${payload.data.title}",
              fontSize: "48dp",
              fontWeight: "700",
              color: COLORS.text,
            },
            {
              type: "Text",
              text: "${payload.data.subtitle}",
              fontSize: "24dp",
              color: COLORS.muted,
              paddingBottom: "@spacingLarge",
            },
            {
              type: "Container",
              direction: "row",
              data: "${payload.data.stats}",
              numbered: true,
              items: [
                {
                  type: "Container",
                  width: "30vw",
                  height: "40vh",
                  backgroundColor: COLORS.surface,
                  margin: "8dp",
                  paddingTop: "@spacingLarge",
                  alignItems: "center",
                  justifyContent: "center",
                  items: [
                    {
                      type: "Text",
                      text: "${data.value}",
                      fontSize: "60dp",
                      fontWeight: "700",
                      color: COLORS.primary,
                    },
                    {
                      type: "Text",
                      text: "${data.label}",
                      fontSize: "22dp",
                      color: COLORS.muted,
                    },
                  ],
                },
              ],
            },
            ...extraItems,
          ],
        },
      ],
    },
  };
}

// Egg stats screen: total eggs, dozens, and per-day rate as three stat tiles.
export const eggStatsDocument = statScreen();

// Feed inventory screen: a header plus one row per feed type, each with a
// labeled on-hand bar (width bound to payload's percent) and a days-remaining
// readout. Uses the shared dark palette via inline hex like the egg screens.
export const feedInventoryDocument = {
  type: "APL",
  version: "2024.2",
  theme: "dark",
  mainTemplate: {
    parameters: ["payload"],
    items: [
      {
        type: "Container",
        width: "100vw",
        height: "100vh",
        direction: "column",
        backgroundColor: COLORS.background,
        paddingLeft: "6vw",
        paddingRight: "6vw",
        paddingTop: "5vh",
        paddingBottom: "5vh",
        items: [
          {
            type: "Text",
            text: "${payload.data.title}",
            fontSize: "46dp",
            fontWeight: "700",
            color: COLORS.text,
          },
          {
            type: "Text",
            text: "${payload.data.subtitle}",
            fontSize: "22dp",
            color: COLORS.muted,
            paddingBottom: "3vh",
          },
          {
            type: "Sequence",
            grow: 1,
            width: "100%",
            data: "${payload.data.feeds}",
            scrollDirection: "vertical",
            item: {
              type: "Container",
              width: "100%",
              paddingTop: "1.4vh",
              paddingBottom: "1.4vh",
              items: [
                {
                  type: "Container",
                  direction: "row",
                  width: "100%",
                  alignItems: "center",
                  items: [
                    {
                      type: "Text",
                      text: "${data.name}",
                      color: COLORS.text,
                      fontSize: "26dp",
                      grow: 1,
                    },
                    {
                      type: "Text",
                      text: "${data.onHand}",
                      color: COLORS.primary,
                      fontSize: "26dp",
                      fontWeight: "700",
                    },
                  ],
                },
                {
                  type: "Frame",
                  width: "100%",
                  height: "14dp",
                  backgroundColor: COLORS.surface,
                  borderRadius: "7dp",
                  marginTop: "0.8vh",
                  item: {
                    type: "Frame",
                    width: "${data.percent}%",
                    height: "14dp",
                    backgroundColor: COLORS.primary,
                    borderRadius: "7dp",
                  },
                },
                {
                  type: "Text",
                  text: "${data.daysRemaining}",
                  color: COLORS.muted,
                  fontSize: "20dp",
                  paddingTop: "0.6vh",
                },
              ],
            },
          },
        ],
      },
    ],
  },
};

// Egg cost screen: cost-per-dozen vs store price tiles plus a cheaper /
// more-expensive badge bound to payload.data.badge.
export const eggCostDocument = statScreen([
  {
    type: "Container",
    direction: "row",
    paddingTop: "@spacingLarge",
    alignItems: "center",
    items: [
      {
        type: "Frame",
        backgroundColor: "${payload.data.badge.color}",
        borderRadius: "20dp",
        paddingLeft: "16dp",
        paddingRight: "16dp",
        paddingTop: "8dp",
        paddingBottom: "8dp",
        item: {
          type: "Text",
          text: "${payload.data.badge.text}",
          fontSize: "24dp",
          fontWeight: "700",
          color: COLORS.text,
        },
      },
    ],
  },
]);
