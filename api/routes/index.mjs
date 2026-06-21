import { registerHealthRoutes } from "./health.mjs";
import { registerFeedRoutes } from "./feed.mjs";

// Single shared route-registration point. Each feature stream adds ONE
// import line above and ONE registration line below, so wiring a new
// domain into the router is a one-file, two-line change and merge
// conflicts stay trivial.
export function registerRoutes(app) {
  registerHealthRoutes(app);
  registerFeedRoutes(app);
}
