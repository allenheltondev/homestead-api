import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CreateEggCollectionRequest,
  EggCollection,
  EggCollectionFilters,
  EggCollectionListResponse,
} from './types';

export async function listEggCollections(
  apiFetch: ApiFetch,
  filters: EggCollectionFilters = {},
): Promise<EggCollectionListResponse> {
  return apiFetch<EggCollectionListResponse>('/egg-collections', {
    query: {
      from: filters.from,
      to: filters.to,
      birdType: filters.birdType,
    },
  });
}

export async function createEggCollection(
  apiFetch: ApiFetch,
  payload: CreateEggCollectionRequest,
): Promise<EggCollection> {
  return apiFetch<EggCollection>('/egg-collections', { method: 'POST', body: payload });
}

export async function deleteEggCollection(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/egg-collections/${id}`, { method: 'DELETE' });
}
