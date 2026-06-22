import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CreatePlantingRequest,
  Planting,
  PlantingFilters,
  PlantingListResponse,
  UpdatePlantingRequest,
} from './types';

export async function listPlantings(
  apiFetch: ApiFetch,
  filters: PlantingFilters = {},
): Promise<PlantingListResponse> {
  return apiFetch<PlantingListResponse>('/plantings', {
    query: { bedId: filters.bedId, status: filters.status },
  });
}

export async function createPlanting(
  apiFetch: ApiFetch,
  payload: CreatePlantingRequest,
): Promise<Planting> {
  return apiFetch<Planting>('/plantings', { method: 'POST', body: payload });
}

export async function updatePlanting(
  apiFetch: ApiFetch,
  id: string,
  payload: UpdatePlantingRequest,
): Promise<Planting> {
  return apiFetch<Planting>(`/plantings/${id}`, { method: 'PATCH', body: payload });
}

export async function deletePlanting(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/plantings/${id}`, { method: 'DELETE' });
}
