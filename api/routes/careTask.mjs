import { emptyResponse, jsonResponse, parseBody } from "../services/http.mjs";
import { publishEvent } from "../services/events.mjs";
import {
  formatCareTask,
  validateCareTaskCreate,
  validateCareTaskUpdate,
} from "../validation/careTask.mjs";
import {
  completeCareTask,
  createCareTask,
  deleteCareTask,
  listCareTasks,
  updateCareTask,
} from "../domain/careTask.mjs";

// Care task routes. Handlers stay thin: validate -> domain -> format. Keys +
// access patterns live in api/domain/careTask.mjs; listing is a single GSI1
// Query on the CARETASK collection partition ordered by nextDueAt (no Scans).
export function registerCareTaskRoutes(app) {
  // POST /care-tasks -- create a recurring task and publish CareTaskCreated.
  app.post("/care-tasks", async ({ event }) => {
    const fields = validateCareTaskCreate(parseBody(event));
    const item = await createCareTask(fields);

    await publishEvent("CareTaskCreated", {
      id: item.id,
      title: item.title,
      category: item.category,
      nextDueAt: item.nextDueAt,
    });

    return jsonResponse(201, formatCareTask(item));
  });

  // GET /care-tasks -- list all tasks via GSI1, soonest-due first (no Scan).
  app.get("/care-tasks", async () => {
    const items = await listCareTasks();
    return jsonResponse(200, {
      care_tasks: items.map(formatCareTask),
    });
  });

  // PATCH /care-tasks/{id} -- edit task fields.
  app.patch("/care-tasks/:id", async ({ event, params }) => {
    const fields = validateCareTaskUpdate(parseBody(event));
    const item = await updateCareTask(params.id, fields);
    return jsonResponse(200, formatCareTask(item));
  });

  // POST /care-tasks/{id}/complete -- mark done now; advance nextDueAt.
  app.post("/care-tasks/:id/complete", async ({ params }) => {
    const item = await completeCareTask(params.id);

    await publishEvent("CareTaskCompleted", {
      id: item.id,
      title: item.title,
      lastDoneAt: item.lastDoneAt,
      nextDueAt: item.nextDueAt,
    });

    return jsonResponse(200, formatCareTask(item));
  });

  // DELETE /care-tasks/{id} -- cleanup. Conditional delete (no Scan).
  app.delete("/care-tasks/:id", async ({ params }) => {
    await deleteCareTask(params.id);
    return emptyResponse(204);
  });
}
