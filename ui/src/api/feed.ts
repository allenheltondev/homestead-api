import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CreateFeedPurchaseRequest,
  FeedPurchase,
  FeedPurchaseFilters,
  FeedPurchaseListResponse,
} from './types';

export async function listFeedPurchases(
  apiFetch: ApiFetch,
  filters: FeedPurchaseFilters = {},
): Promise<FeedPurchaseListResponse> {
  return apiFetch<FeedPurchaseListResponse>('/feed-purchases', {
    query: {
      from: filters.from,
      to: filters.to,
      type: filters.type,
    },
  });
}

export async function createFeedPurchase(
  apiFetch: ApiFetch,
  payload: CreateFeedPurchaseRequest,
): Promise<FeedPurchase> {
  return apiFetch<FeedPurchase>('/feed-purchases', { method: 'POST', body: payload });
}

export async function deleteFeedPurchase(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/feed-purchases/${id}`, { method: 'DELETE' });
}
