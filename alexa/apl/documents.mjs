// APL document templates for the Homestead skill's egg screens. These are
// plain JSON objects (no ask-sdk dependency) rendered only on APL-capable
// devices; headless devices ignore them and hear the spoken response instead.
//
// Palette: the dark "homestead green" theme shared with the dashboard.

export const COLORS = {
  background: "#10241b",
  surface: "#173a2a",
  primary: "#3fa66a",
  text: "#f1f7f2",
  muted: "#9bc4ab",
  cheaper: "#3fa66a",
  expensive: "#c0563f",
};

// A simple header + three-stat layout shared by both egg screens. The
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
