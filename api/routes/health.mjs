import { jsonResponse } from "../services/http.mjs";

// Liveness probe. No auth dependency on data, no DynamoDB read -- just
// confirms the Lambda is reachable and routing works end to end. Feature
// streams add their own register*Routes alongside this one in
// routes/index.mjs.
export function registerHealthRoutes(app) {
  app.get("/health", async () => {
    return jsonResponse(200, { status: "ok" });
  });
}
