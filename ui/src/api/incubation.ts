import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CreateIncubationBatchRequest,
  IncubationBatch,
  IncubationBatchListResponse,
  UpdateIncubationBatchRequest,
} from './types';

export async function listIncubationBatches(
  apiFetch: ApiFetch,
): Promise<IncubationBatchListResponse> {
  return apiFetch<IncubationBatchListResponse>('/incubation-batches');
}

export async function createIncubationBatch(
  apiFetch: ApiFetch,
  payload: CreateIncubationBatchRequest,
): Promise<IncubationBatch> {
  return apiFetch<IncubationBatch>('/incubation-batches', {
    method: 'POST',
    body: payload,
  });
}

export async function updateIncubationBatch(
  apiFetch: ApiFetch,
  id: string,
  payload: UpdateIncubationBatchRequest,
): Promise<IncubationBatch> {
  return apiFetch<IncubationBatch>(`/incubation-batches/${id}`, {
    method: 'PATCH',
    body: payload,
  });
}

export async function deleteIncubationBatch(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/incubation-batches/${id}`, { method: 'DELETE' });
}
