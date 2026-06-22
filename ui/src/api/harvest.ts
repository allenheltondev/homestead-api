import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CreateHarvestLogRequest,
  HarvestLog,
  HarvestLogFilters,
  HarvestLogListResponse,
  GrnListing,
} from './types';

export async function listHarvestLogs(
  apiFetch: ApiFetch,
  filters: HarvestLogFilters = {},
): Promise<HarvestLogListResponse> {
  return apiFetch<HarvestLogListResponse>('/harvest-logs', {
    query: {
      from: filters.from,
      to: filters.to,
      crop: filters.crop,
    },
  });
}

export async function createHarvestLog(
  apiFetch: ApiFetch,
  payload: CreateHarvestLogRequest,
): Promise<HarvestLog> {
  return apiFetch<HarvestLog>('/harvest-logs', { method: 'POST', body: payload });
}

export async function deleteHarvestLog(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/harvest-logs/${id}`, { method: 'DELETE' });
}

// POST /harvest-logs/{id}/publish — share a harvest's surplus to Good Roots.
// Returns the created/updated listing. Optional quantity/note describe how much
// of the harvest is offered.
export async function publishHarvestLog(
  apiFetch: ApiFetch,
  id: string,
  payload: PublishHarvestRequest = {},
): Promise<GrnListing> {
  return apiFetch<GrnListing>(`/harvest-logs/${id}/publish`, {
    method: 'POST',
    body: payload,
  });
}

// DELETE /harvest-logs/{id}/publish — unshare (delist) the harvest's surplus.
export async function unpublishHarvestLog(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/harvest-logs/${id}/publish`, { method: 'DELETE' });
}

export interface PublishHarvestRequest {
  quantity?: number;
  unit?: string;
  note?: string;
}
