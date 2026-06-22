import type { ApiFetch } from '../auth/useApiFetch';
import type {
  CareDueStats,
  DigestStats,
  EggCostByFlockRow,
  EggCostStats,
  EggStats,
  FeedInventoryStats,
  FeedStats,
  GrowoutStats,
  HealthStats,
  HerdStats,
  IncubationStats,
  LifecycleStats,
  MilkCostStats,
  MilkStats,
  MortalityStats,
  PastureOccupancyStats,
  PnlStats,
  StatsSummary,
  UpcomingBreedingStats,
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

// GET /stats/health?period= — health/vet spend totals: overall, by category,
// and per animal. period is YYYY-MM, YYYY, or a keyword; defaults server-side.
export async function getHealth(
  apiFetch: ApiFetch,
  period?: string,
): Promise<HealthStats> {
  return apiFetch<HealthStats>('/stats/health', { query: { period } });
}

// GET /stats/mortality?period= — deaths-by-cause plus an overall loss rate.
export async function getMortality(
  apiFetch: ApiFetch,
  period?: string,
): Promise<MortalityStats> {
  return apiFetch<MortalityStats>('/stats/mortality', { query: { period } });
}

// GET /stats/digest — a weekly rollup with headline numbers and summary lines.
export async function getDigest(apiFetch: ApiFetch): Promise<DigestStats> {
  return apiFetch<DigestStats>('/stats/digest');
}

// GET /stats/egg-cost/by-flock?period= — per-flock cost-per-dozen analytics.
export async function getEggCostByFlock(
  apiFetch: ApiFetch,
  period?: string,
): Promise<EggCostByFlockRow[]> {
  return apiFetch<EggCostByFlockRow[]>('/stats/egg-cost/by-flock', {
    query: { period },
  });
}

// GET /stats/milk?period= — milk production totals plus a per-day series.
export async function getMilkStats(
  apiFetch: ApiFetch,
  period?: string,
): Promise<MilkStats> {
  return apiFetch<MilkStats>('/stats/milk', { query: { period } });
}

// GET /stats/milk-cost?period= — cost-per-gallon from dairy feed spend.
export async function getMilkCost(
  apiFetch: ApiFetch,
  period?: string,
): Promise<MilkCostStats> {
  return apiFetch<MilkCostStats>('/stats/milk-cost', { query: { period } });
}

// GET /stats/incubation — active batches, eggs incubating, and hatch rate.
export async function getIncubation(apiFetch: ApiFetch): Promise<IncubationStats> {
  return apiFetch<IncubationStats>('/stats/incubation');
}

// GET /stats/breeding/upcoming — breedings/kiddings with an upcoming due date.
export async function getBreedingUpcoming(
  apiFetch: ApiFetch,
): Promise<UpcomingBreedingStats> {
  return apiFetch<UpcomingBreedingStats>('/stats/breeding/upcoming');
}

// GET /stats/growout — active grow-out batches and processed-this-year totals.
export async function getGrowout(apiFetch: ApiFetch): Promise<GrowoutStats> {
  return apiFetch<GrowoutStats>('/stats/growout');
}

// GET /stats/care/due — care tasks due now or soon, with overdue counts.
export async function getCareDue(apiFetch: ApiFetch): Promise<CareDueStats> {
  return apiFetch<CareDueStats>('/stats/care/due');
}

// GET /stats/pnl?period= — homestead costs vs. outputs with a net result.
export async function getPnl(apiFetch: ApiFetch, period?: string): Promise<PnlStats> {
  return apiFetch<PnlStats>('/stats/pnl', { query: { period } });
}
