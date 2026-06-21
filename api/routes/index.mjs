import { registerHealthRoutes } from "./health.mjs";
import { registerStatsRoutes } from "./stats.mjs";
import { registerPastureRoutes } from "./pastures.mjs";
import { registerMovementRoutes } from "./movements.mjs";
import { registerFeedRoutes } from "./feed.mjs";
import { registerFeedConsumptionRoutes } from "./feedConsumption.mjs";
import { registerEggRoutes } from "./eggs.mjs";
import { registerAnimalRoutes } from "./animals.mjs";

// Single shared route-registration point. Each feature stream adds ONE
// import line above and ONE registration line below, so wiring a new
// domain into the router is a one-file, two-line change and merge
// conflicts stay trivial.
export function registerRoutes(app) {
  registerHealthRoutes(app);
  registerStatsRoutes(app);
  registerPastureRoutes(app);
  registerMovementRoutes(app);
  registerFeedRoutes(app);
  registerFeedConsumptionRoutes(app);
  registerEggRoutes(app);
  registerAnimalRoutes(app);
}
