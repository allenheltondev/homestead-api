import type { ApiFetch } from '../auth/useApiFetch';
import type {
  FeedStats,
  HerdStats,
  LifecycleStats,
  PastureOccupancyStats,
  StatsSummary,
} from './types';

export async function getHerdStats(apiFetch: ApiFetch): Promise<HerdStats> {
  return apiFetch<HerdStats>('/stats/herd');
}

export async function getPastureOccupancy(
  apiFetch: ApiFetch,
): Promise<PastureOccupancyStats> {
  return apiFetch<PastureOccupancyStats>('/stats/pastures');
}

// period is YYYY-MM or YYYY; defaults server-side to the current month.
export async function getBirthStats(
  apiFetch: ApiFetch,
  period?: string,
): Promise<LifecycleStats> {
  return apiFetch<LifecycleStats>('/stats/births', { query: { period } });
}

export async function getDeathStats(
  apiFetch: ApiFetch,
  period?: string,
): Promise<LifecycleStats> {
  return apiFetch<LifecycleStats>('/stats/deaths', { query: { period } });
}

export async function getFeedStats(
  apiFetch: ApiFetch,
  period?: string,
): Promise<FeedStats> {
  return apiFetch<FeedStats>('/stats/feed', { query: { period } });
}

export async function getStatsSummary(apiFetch: ApiFetch): Promise<StatsSummary> {
  return apiFetch<StatsSummary>('/stats/summary');
}
