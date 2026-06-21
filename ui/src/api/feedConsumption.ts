import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CreateFeedConsumptionRequest,
  FeedConsumption,
  FeedConsumptionListResponse,
} from './types';

export async function listFeedConsumption(
  apiFetch: ApiFetch,
  from?: string,
  to?: string,
  type?: string,
): Promise<FeedConsumptionListResponse> {
  return apiFetch<FeedConsumptionListResponse>('/feed-consumption', {
    query: { from, to, type },
  });
}

export async function createFeedConsumption(
  apiFetch: ApiFetch,
  payload: CreateFeedConsumptionRequest,
): Promise<FeedConsumption> {
  return apiFetch<FeedConsumption>('/feed-consumption', {
    method: 'POST',
    body: payload,
  });
}

export async function deleteFeedConsumption(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/feed-consumption/${id}`, { method: 'DELETE' });
}
