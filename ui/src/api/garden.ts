import type { ApiFetch } from '../auth/useApiFetch';
import type { GardenStats, PlantingCalendar } from './types';

// GET /stats/garden — garden output totals (yield by crop, harvest count) and
// optional cost/yield economics.
export async function getGardenStats(
  apiFetch: ApiFetch,
  period?: string,
): Promise<GardenStats> {
  return apiFetch<GardenStats>('/stats/garden', { query: { period } });
}

// GET /garden/calendar — planting/harvest windows per crop or bed for a
// calendar/timeline view.
export async function getPlantingCalendar(
  apiFetch: ApiFetch,
  year?: string,
): Promise<PlantingCalendar> {
  return apiFetch<PlantingCalendar>('/garden/calendar', { query: { year } });
}
