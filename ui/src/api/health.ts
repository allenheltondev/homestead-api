import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CreateHealthExpenseRequest,
  HealthExpense,
  HealthExpenseFilters,
  HealthExpenseListResponse,
} from './types';

export async function listHealthExpenses(
  apiFetch: ApiFetch,
  filters: HealthExpenseFilters = {},
): Promise<HealthExpenseListResponse> {
  return apiFetch<HealthExpenseListResponse>('/health-expenses', {
    query: {
      from: filters.from,
      to: filters.to,
      category: filters.category,
    },
  });
}

export async function createHealthExpense(
  apiFetch: ApiFetch,
  payload: CreateHealthExpenseRequest,
): Promise<HealthExpense> {
  return apiFetch<HealthExpense>('/health-expenses', { method: 'POST', body: payload });
}

export async function deleteHealthExpense(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/health-expenses/${id}`, { method: 'DELETE' });
}
