import { ApiError } from '../auth/useApiFetch';
import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CreateGrnClaimRequest,
  GrnClaim,
  GrnDiscoverFilters,
  GrnDiscoverResponse,
  GrnListingsResponse,
  GrnRequestsResponse,
} from './types';

// When the Good Roots Network integration isn't configured or the homestead
// isn't connected, the API responds with a typed error. We surface that as a
// friendly "Connect Good Roots" empty state rather than a hard failure.
const NOT_CONNECTED_CODES = new Set([
  'GRN_NOT_CONFIGURED',
  'GRN_UNAUTHORIZED',
  'NOT_CONFIGURED',
  'UNAUTHORIZED',
]);

// True when an error means Good Roots simply isn't connected yet (so the UI
// should show the connect prompt) rather than a genuine failure.
export function isGrnNotConnected(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.code && NOT_CONNECTED_CODES.has(err.code)) return true;
  // Fall back to status codes the API may use before a connection exists.
  return err.status === 401 || err.status === 403 || err.status === 501;
}

export async function getMyListings(apiFetch: ApiFetch): Promise<GrnListingsResponse> {
  return apiFetch<GrnListingsResponse>('/grn/my-listings');
}

export async function discoverSurplus(
  apiFetch: ApiFetch,
  filters: GrnDiscoverFilters,
): Promise<GrnDiscoverResponse> {
  return apiFetch<GrnDiscoverResponse>('/grn/discover', {
    query: {
      lat: filters.lat,
      lng: filters.lng,
      radius: filters.radius,
    },
  });
}

export async function getCommunityRequests(
  apiFetch: ApiFetch,
): Promise<GrnRequestsResponse> {
  return apiFetch<GrnRequestsResponse>('/grn/requests');
}

export async function createClaim(
  apiFetch: ApiFetch,
  payload: CreateGrnClaimRequest,
): Promise<GrnClaim> {
  return apiFetch<GrnClaim>('/grn/claims', { method: 'POST', body: payload });
}

export async function getClaim(apiFetch: ApiFetch, id: string): Promise<GrnClaim> {
  return apiFetch<GrnClaim>(`/grn/claims/${id}`);
}
