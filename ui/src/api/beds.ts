import type { ApiFetch } from '../auth/useApiFetch';
import type {
  Bed,
  BedListResponse,
  CreateBedRequest,
  UpdateBedRequest,
} from './types';

export async function listBeds(apiFetch: ApiFetch): Promise<BedListResponse> {
  return apiFetch<BedListResponse>('/beds');
}

export async function createBed(
  apiFetch: ApiFetch,
  payload: CreateBedRequest,
): Promise<Bed> {
  return apiFetch<Bed>('/beds', { method: 'POST', body: payload });
}

export async function updateBed(
  apiFetch: ApiFetch,
  id: string,
  payload: UpdateBedRequest,
): Promise<Bed> {
  return apiFetch<Bed>(`/beds/${id}`, { method: 'PATCH', body: payload });
}

export async function deleteBed(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/beds/${id}`, { method: 'DELETE' });
}
