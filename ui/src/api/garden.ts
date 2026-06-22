import type { ApiFetch } from '../auth/useApiFetch';
import type { GardenStats } from './types';

// GET /stats/garden — garden output totals (yield by crop, harvest count) and
// optional cost/yield economics.
export async function getGardenStats(
  apiFetch: ApiFetch,
  period?: string,
): Promise<GardenStats> {
  return apiFetch<GardenStats>('/stats/garden', { query: { period } });
}
