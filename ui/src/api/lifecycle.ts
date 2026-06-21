import type { ApiFetch } from '../auth/useApiFetch';
import type {
  AnimalEventsResponse,
  BirthResponse,
  LifecycleResponse,
  RecordBirthRequest,
  RecordDeathRequest,
  RecordSaleRequest,
} from './types';

// POST /births — creates the animal and its BIRTH event in one transaction.
export async function recordBirth(
  apiFetch: ApiFetch,
  payload: RecordBirthRequest,
): Promise<BirthResponse> {
  return apiFetch<BirthResponse>('/births', { method: 'POST', body: payload });
}

export async function listAnimalEvents(
  apiFetch: ApiFetch,
  animalId: string,
): Promise<AnimalEventsResponse> {
  return apiFetch<AnimalEventsResponse>(`/animals/${animalId}/events`);
}

// POST /animals/{id}/death — terminal transition to deceased + DEATH event.
export async function recordDeath(
  apiFetch: ApiFetch,
  animalId: string,
  payload: RecordDeathRequest,
): Promise<LifecycleResponse> {
  return apiFetch<LifecycleResponse>(`/animals/${animalId}/death`, {
    method: 'POST',
    body: payload,
  });
}

// POST /animals/{id}/sale — terminal transition to sold + SALE event.
export async function recordSale(
  apiFetch: ApiFetch,
  animalId: string,
  payload: RecordSaleRequest,
): Promise<LifecycleResponse> {
  return apiFetch<LifecycleResponse>(`/animals/${animalId}/sale`, {
    method: 'POST',
    body: payload,
  });
}
