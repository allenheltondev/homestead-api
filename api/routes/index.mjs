import { registerHealthRoutes } from "./health.mjs";
import { registerStatsRoutes } from "./stats.mjs";
import { registerPastureRoutes } from "./pastures.mjs";
import { registerMovementRoutes } from "./movements.mjs";
import { registerFeedRoutes } from "./feed.mjs";
import { registerFeedConsumptionRoutes } from "./feedConsumption.mjs";
import { registerHealthExpenseRoutes } from "./healthExpense.mjs";
import { registerEggRoutes } from "./eggs.mjs";
import { registerAnimalRoutes } from "./animals.mjs";
import { registerMilkRoutes } from "./milk.mjs";
import { registerIncubationRoutes } from "./incubation.mjs";
import { registerBreedingRoutes } from "./breeding.mjs";
import { registerGrowoutRoutes } from "./growout.mjs";
import { registerCareTaskRoutes } from "./careTask.mjs";
import { registerSalesRoutes } from "./sales.mjs";
import { registerHarvestRoutes } from "./harvest.mjs";
import { registerGardenRoutes } from "./garden.mjs";
import { registerGrnRoutes } from "./grn.mjs";
import { registerGrnGardenRoutes } from "./grnGarden.mjs";

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
  registerHealthExpenseRoutes(app);
  registerEggRoutes(app);
  registerAnimalRoutes(app);
  registerMilkRoutes(app);
  registerIncubationRoutes(app);
  registerBreedingRoutes(app);
  registerGrowoutRoutes(app);
  registerCareTaskRoutes(app);
  registerSalesRoutes(app);
  registerHarvestRoutes(app);
  registerGardenRoutes(app);
  registerGrnRoutes(app);
  registerGrnGardenRoutes(app);
}
