import type { ApiFetch } from '../auth/useApiFetch';
import type {
  EggCostStats,
  EggStats,
  FeedInventoryStats,
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

// period is YYYY-MM, YYYY, or a keyword like `week`/`month`; defaults
// server-side to the current month.
export async function getEggStats(
  apiFetch: ApiFetch,
  period?: string,
): Promise<EggStats> {
  return apiFetch<EggStats>('/stats/eggs', { query: { period } });
}

// Cost-per-dozen analytics. storePrice (USD per dozen) is optional and lets
// the server compute savings versus buying from the store.
export async function getEggCost(
  apiFetch: ApiFetch,
  period?: string,
  storePrice?: number,
): Promise<EggCostStats> {
  return apiFetch<EggCostStats>('/stats/egg-cost', {
    query: { period, storePricePerDozen: storePrice },
  });
}

export async function getStatsSummary(apiFetch: ApiFetch): Promise<StatsSummary> {
  return apiFetch<StatsSummary>('/stats/summary');
}

// Per-type feed on-hand position plus a burn-down forecast (days remaining and
// projected run-out date) derived from purchases and logged consumption.
export async function getFeedInventory(apiFetch: ApiFetch): Promise<FeedInventoryStats> {
  return apiFetch<FeedInventoryStats>('/stats/feed-inventory');
}
