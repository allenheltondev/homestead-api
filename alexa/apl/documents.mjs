// APL (Alexa Presentation Language) documents for screen devices (Echo
// Show, Fire TV, etc). Authored as JS objects so they bundle inline with
// esbuild and load under jest without JSON import-attribute concerns.
//
// The skill only sends these on devices that report APL support; on
// headless Echo devices the spoken response is unaffected.

// Shared dark "homestead green" palette, duplicated per document so each
// is a self-contained, renderable APL document.
const colors = {
  colorBackground: "#15281d",
  colorSurface: "#1f3a2b",
  colorAccent: "#8fd19e",
  colorText: "#f4f7f4",
  colorMuted: "#aebcb0",
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
