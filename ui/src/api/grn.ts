import { ApiError } from '../auth/useApiFetch';
import type { ApiFetch } from '../auth/useApiFetch';
import type {
  Bed,
  BedListResponse,
  CatalogCropsResponse,
  CatalogVarietiesResponse,
  CreateBedRequest,
  CreateGrnClaimRequest,
  CreateGrowerCropRequest,
  GrnClaim,
  GrnDiscoverFilters,
  GrnDiscoverResponse,
  GrnListing,
  GrnListingsResponse,
  GrnRequestsResponse,
  GrowerCrop,
  GrowerCropListResponse,
  HarvestItem,
  HarvestLogResponse,
  PublishCropSurplusRequest,
  RecordCropHarvestRequest,
  UpdateBedRequest,
  UpdateGrowerCropRequest,
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

// --- Crop library (grower crops) ---------------------------------------
// Managed in Good Roots through the homestead pass-through at /grn/crops.

export async function listGrowerCrops(
  apiFetch: ApiFetch,
): Promise<GrowerCropListResponse> {
  return apiFetch<GrowerCropListResponse>('/grn/crops');
}

export async function createGrowerCrop(
  apiFetch: ApiFetch,
  payload: CreateGrowerCropRequest,
): Promise<GrowerCrop> {
  return apiFetch<GrowerCrop>('/grn/crops', { method: 'POST', body: payload });
}

export async function getGrowerCrop(
  apiFetch: ApiFetch,
  id: string,
): Promise<GrowerCrop> {
  return apiFetch<GrowerCrop>(`/grn/crops/${id}`);
}

export async function updateGrowerCrop(
  apiFetch: ApiFetch,
  id: string,
  payload: UpdateGrowerCropRequest,
): Promise<GrowerCrop> {
  return apiFetch<GrowerCrop>(`/grn/crops/${id}`, { method: 'PUT', body: payload });
}

export async function deleteGrowerCrop(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/grn/crops/${id}`, { method: 'DELETE' });
}

// --- Per-crop harvests -------------------------------------------------
// Harvests are recorded against a Good Roots crop (GET/POST only — GRN does
// not support editing or deleting individual harvests).

// GET /grn/crops/{cropLibraryId}/harvests — the crop's GRN harvest log plus a
// running total and harvest count.
export async function getCropHarvests(
  apiFetch: ApiFetch,
  cropLibraryId: string,
): Promise<HarvestLogResponse> {
  return apiFetch<HarvestLogResponse>(`/grn/crops/${cropLibraryId}/harvests`);
}

// POST /grn/crops/{cropLibraryId}/harvests — record a harvest. amount is
// required (> 0); unit/harvestedOn/notes are optional.
export async function recordCropHarvest(
  apiFetch: ApiFetch,
  cropLibraryId: string,
  body: RecordCropHarvestRequest,
): Promise<HarvestItem> {
  return apiFetch<HarvestItem>(`/grn/crops/${cropLibraryId}/harvests`, {
    method: 'POST',
    body,
  });
}

// POST /grn/crops/{cropLibraryId}/publish-surplus — share a crop's surplus to
// the Good Roots community. Returns the created listing.
export async function publishCropSurplus(
  apiFetch: ApiFetch,
  cropLibraryId: string,
  body: PublishCropSurplusRequest = {},
): Promise<GrnListing> {
  return apiFetch<GrnListing>(`/grn/crops/${cropLibraryId}/publish-surplus`, {
    method: 'POST',
    body,
  });
}

// --- Shared catalog ----------------------------------------------------
// Read-only reference data for the crop-library picker.

export async function listCatalogCrops(
  apiFetch: ApiFetch,
): Promise<CatalogCropsResponse> {
  return apiFetch<CatalogCropsResponse>('/grn/catalog/crops');
}

export async function listCatalogVarieties(
  apiFetch: ApiFetch,
  cropId: string,
): Promise<CatalogVarietiesResponse> {
  return apiFetch<CatalogVarietiesResponse>(
    `/grn/catalog/crops/${cropId}/varieties`,
  );
}

// --- Garden beds -------------------------------------------------------
// Managed in Good Roots through the homestead pass-through at /grn/beds.

export async function listBeds(apiFetch: ApiFetch): Promise<BedListResponse> {
  return apiFetch<BedListResponse>('/grn/beds');
}

export async function createBed(
  apiFetch: ApiFetch,
  payload: CreateBedRequest,
): Promise<Bed> {
  return apiFetch<Bed>('/grn/beds', { method: 'POST', body: payload });
}

export async function getBed(apiFetch: ApiFetch, id: string): Promise<Bed> {
  return apiFetch<Bed>(`/grn/beds/${id}`);
}

export async function updateBed(
  apiFetch: ApiFetch,
  id: string,
  payload: UpdateBedRequest,
): Promise<Bed> {
  return apiFetch<Bed>(`/grn/beds/${id}`, { method: 'PUT', body: payload });
}

export async function deleteBed(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/grn/beds/${id}`, { method: 'DELETE' });
}
