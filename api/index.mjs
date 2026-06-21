import { app } from "./app.mjs";
import { createHttpRouterHandler } from "./services/http-handler.mjs";

// Lambda entry point. Every route -- animals, pastures, moves, lifecycle
// events, feed -- runs through this single function. Powertools Router
// dispatches based on method + path inside the wrapper.
export const handler = createHttpRouterHandler({
  app,
  handlerName: "homestead-api",
});
