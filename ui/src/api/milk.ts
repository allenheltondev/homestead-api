import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CreateMilkLogRequest,
  MilkLog,
  MilkLogFilters,
  MilkLogListResponse,
} from './types';

export async function listMilkLogs(
  apiFetch: ApiFetch,
  filters: MilkLogFilters = {},
): Promise<MilkLogListResponse> {
  return apiFetch<MilkLogListResponse>('/milk-logs', {
    query: {
      from: filters.from,
      to: filters.to,
    },
  });
}

export async function createMilkLog(
  apiFetch: ApiFetch,
  payload: CreateMilkLogRequest,
): Promise<MilkLog> {
  return apiFetch<MilkLog>('/milk-logs', { method: 'POST', body: payload });
}

export async function deleteMilkLog(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/milk-logs/${id}`, { method: 'DELETE' });
}
