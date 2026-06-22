import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CreateSaleRequest,
  Sale,
  SaleFilters,
  SaleListResponse,
} from './types';

export async function listSales(
  apiFetch: ApiFetch,
  filters: SaleFilters = {},
): Promise<SaleListResponse> {
  return apiFetch<SaleListResponse>('/sales', {
    query: {
      from: filters.from,
      to: filters.to,
    },
  });
}

export async function createSale(
  apiFetch: ApiFetch,
  payload: CreateSaleRequest,
): Promise<Sale> {
  return apiFetch<Sale>('/sales', { method: 'POST', body: payload });
}

export async function deleteSale(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/sales/${id}`, { method: 'DELETE' });
}
