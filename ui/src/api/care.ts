import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CareTask,
  CareTaskFilters,
  CareTaskListResponse,
  CreateCareTaskRequest,
  UpdateCareTaskRequest,
} from './types';

export async function listCareTasks(
  apiFetch: ApiFetch,
  filters: CareTaskFilters = {},
): Promise<CareTaskListResponse> {
  return apiFetch<CareTaskListResponse>('/care-tasks', {
    query: { status: filters.status },
  });
}

export async function createCareTask(
  apiFetch: ApiFetch,
  payload: CreateCareTaskRequest,
): Promise<CareTask> {
  return apiFetch<CareTask>('/care-tasks', { method: 'POST', body: payload });
}

export async function updateCareTask(
  apiFetch: ApiFetch,
  id: string,
  payload: UpdateCareTaskRequest,
): Promise<CareTask> {
  return apiFetch<CareTask>(`/care-tasks/${id}`, { method: 'PATCH', body: payload });
}

// POST /care-tasks/{id}/complete — marks a task done and, for recurring tasks,
// rolls the due date forward by the cadence (handled server-side).
export async function completeCareTask(apiFetch: ApiFetch, id: string): Promise<CareTask> {
  return apiFetch<CareTask>(`/care-tasks/${id}/complete`, { method: 'POST' });
}

export async function deleteCareTask(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/care-tasks/${id}`, { method: 'DELETE' });
}
