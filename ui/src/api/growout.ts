import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CreateGrowoutBatchRequest,
  GrowoutBatch,
  GrowoutBatchListResponse,
  UpdateGrowoutBatchRequest,
} from './types';

export async function listGrowoutBatches(
  apiFetch: ApiFetch,
): Promise<GrowoutBatchListResponse> {
  return apiFetch<GrowoutBatchListResponse>('/growout');
}

export async function createGrowoutBatch(
  apiFetch: ApiFetch,
  payload: CreateGrowoutBatchRequest,
): Promise<GrowoutBatch> {
  return apiFetch<GrowoutBatch>('/growout', { method: 'POST', body: payload });
}

export async function updateGrowoutBatch(
  apiFetch: ApiFetch,
  id: string,
  payload: UpdateGrowoutBatchRequest,
): Promise<GrowoutBatch> {
  return apiFetch<GrowoutBatch>(`/growout/${id}`, { method: 'PATCH', body: payload });
}
