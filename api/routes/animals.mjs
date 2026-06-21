import { BadRequestError } from "../services/errors.mjs";
import { jsonResponse, emptyResponse, parseBody } from "../services/http.mjs";
import { publishEvent } from "../services/events.mjs";
import {
  validateAnimalCreate,
  validateAnimalUpdate,
  validateAnimalListQuery,
  validateBirth,
  validateDeath,
  validateSale,
  ULID_RE,
} from "../validation/animal.mjs";
import {
  createAnimal,
  getAnimal,
  listAnimals,
  updateAnimal,
  deleteAnimal,
  recordBirth,
  listAnimalEvents,
  recordDeath,
  recordSale,
} from "../domain/animal.mjs";

// Animal + lifecycle routes. Handlers stay thin: validate -> domain -> format.
// Wired into the router via registerAnimalRoutes (one import + one call in
// routes/index.mjs). The Powertools Router passes a request context with
// `.event` (raw proxy event) and `.params` (path params from :id segments).

// Strip the internal single-table key + index attributes before returning an
// animal to the client. Optional fields are omitted by the marshaller, so the
// response only carries what's set.
function formatAnimal(row) {
  if (!row) return row;
  return {
    id: row.id,
    species: row.species,
    breed: row.breed ?? null,
    name: row.name ?? null,
    tag: row.tag ?? null,
    sex: row.sex ?? null,
    dob: row.dob ?? null,
    status: row.status,
    pasture: row.pasture ?? null,
    damId: row.damId ?? null,
    sireId: row.sireId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function formatEvent(row) {
  return {
    type: row.type,
    ts: row.ts,
    date: row.date ?? null,
    dob: row.dob ?? null,
    cause: row.cause ?? null,
    buyer: row.buyer ?? null,
    price: row.price ?? null,
    damId: row.damId ?? null,
    sireId: row.sireId ?? null,
  };
}

function requireUlid(value, field) {
  if (!value || !ULID_RE.test(value)) {
    throw new BadRequestError(`${field} must be a ULID`);
  }
}

export function registerAnimalRoutes(app) {
  app.post("/animals", async ({ event }) => {
    const fields = validateAnimalCreate(parseBody(event));
    const animal = await createAnimal(fields);
    return jsonResponse(201, formatAnimal(animal));
  });

  app.get("/animals", async ({ event }) => {
    const filters = validateAnimalListQuery(event.queryStringParameters ?? {});
    const animals = await listAnimals(filters);
    return jsonResponse(200, { animals: animals.map(formatAnimal) });
  });

  app.get("/animals/:id", async ({ params }) => {
    requireUlid(params.id, "id");
    const animal = await getAnimal(params.id);
    return jsonResponse(200, formatAnimal(animal));
  });

  app.patch("/animals/:id", async ({ event, params }) => {
    requireUlid(params.id, "id");
    const fields = validateAnimalUpdate(parseBody(event));
    const animal = await updateAnimal(params.id, fields);
    return jsonResponse(200, formatAnimal(animal));
  });

  app.delete("/animals/:id", async ({ params }) => {
    requireUlid(params.id, "id");
    await deleteAnimal(params.id);
    return emptyResponse(204);
  });

  // POST /births — creates the animal and its BIRTH lifecycle event in one
  // transaction, then publishes AnimalBorn.
  app.post("/births", async ({ event }) => {
    const fields = validateBirth(parseBody(event));
    const { animal, event: birthEvent } = await recordBirth(fields);
    await publishEvent("AnimalBorn", {
      id: animal.id,
      species: animal.species,
      dob: animal.dob ?? null,
      damId: fields.damId ?? null,
      sireId: fields.sireId ?? null,
    });
    return jsonResponse(201, {
      animal: formatAnimal(animal),
      event: formatEvent(birthEvent),
    });
  });

  app.get("/animals/:id/events", async ({ params }) => {
    requireUlid(params.id, "id");
    const events = await listAnimalEvents(params.id);
    return jsonResponse(200, { events: events.map(formatEvent) });
  });

  // POST /animals/{id}/death — terminal transition to deceased + DEATH event;
  // publishes AnimalDied. recordDeath throws ConflictError if not active.
  app.post("/animals/:id/death", async ({ event, params }) => {
    requireUlid(params.id, "id");
    const fields = validateDeath(parseBody(event));
    const { animal, event: deathEvent } = await recordDeath(params.id, fields);
    await publishEvent("AnimalDied", {
      id: animal.id,
      species: animal.species,
      date: fields.date ?? null,
      cause: fields.cause ?? null,
    });
    return jsonResponse(200, {
      animal: formatAnimal(animal),
      event: formatEvent(deathEvent),
    });
  });

  // POST /animals/{id}/sale — terminal transition to sold + SALE event.
  app.post("/animals/:id/sale", async ({ event, params }) => {
    requireUlid(params.id, "id");
    const fields = validateSale(parseBody(event));
    const { animal, event: saleEvent } = await recordSale(params.id, fields);
    await publishEvent("AnimalSold", {
      id: animal.id,
      species: animal.species,
      date: fields.date ?? null,
      buyer: fields.buyer ?? null,
      price: fields.price ?? null,
    });
    return jsonResponse(200, {
      animal: formatAnimal(animal),
      event: formatEvent(saleEvent),
    });
  });
}
