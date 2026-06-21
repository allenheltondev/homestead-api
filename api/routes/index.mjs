import { registerHealthRoutes } from "./health.mjs";
import { registerPastureRoutes } from "./pastures.mjs";
import { registerMovementRoutes } from "./movements.mjs";

// Single shared route-registration point. Each feature stream adds ONE
// import line above and ONE registration line below, so wiring a new
// domain into the router is a one-file, two-line change and merge
// conflicts stay trivial.
export function registerRoutes(app) {
  registerHealthRoutes(app);
  registerPastureRoutes(app);
  registerMovementRoutes(app);
}
