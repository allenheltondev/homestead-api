import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CreatePastureRequest,
  Pasture,
  PastureAnimalsResponse,
  PastureListResponse,
} from './types';

export async function listPastures(
  apiFetch: ApiFetch,
  options: { limit?: number } = {},
): Promise<PastureListResponse> {
  return apiFetch<PastureListResponse>('/pastures', {
    query: { limit: options.limit ?? 100 },
  });
}

export async function getPasture(apiFetch: ApiFetch, id: string): Promise<Pasture> {
  return apiFetch<Pasture>(`/pastures/${id}`);
}

export async function createPasture(
  apiFetch: ApiFetch,
  payload: CreatePastureRequest,
): Promise<Pasture> {
  return apiFetch<Pasture>('/pastures', { method: 'POST', body: payload });
}

export async function deletePasture(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/pastures/${id}`, { method: 'DELETE' });
}

export async function listPastureAnimals(
  apiFetch: ApiFetch,
  pastureId: string,
): Promise<PastureAnimalsResponse> {
  return apiFetch<PastureAnimalsResponse>(`/pastures/${pastureId}/animals`);
}
