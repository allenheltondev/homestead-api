import type { ApiFetch } from '../auth/useApiFetch';
import type {
  Breeding,
  BreedingListResponse,
  CreateBreedingRequest,
} from './types';

export async function listBreedings(apiFetch: ApiFetch): Promise<BreedingListResponse> {
  return apiFetch<BreedingListResponse>('/breedings');
}

export async function createBreeding(
  apiFetch: ApiFetch,
  payload: CreateBreedingRequest,
): Promise<Breeding> {
  return apiFetch<Breeding>('/breedings', { method: 'POST', body: payload });
}

export async function deleteBreeding(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/breedings/${id}`, { method: 'DELETE' });
}
