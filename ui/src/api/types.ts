// Shared API types for the Homestead dashboard. These mirror the response
// shapes produced by the backend route formatters (api/routes/*.mjs) and the
// domain aggregations (api/domain/stats.mjs).

export type AnimalStatus = 'active' | 'sold' | 'deceased';
export type AnimalSex = 'female' | 'male' | 'unknown';

export const FEED_UNITS = ['lb', 'kg', 'ton', 'bag', 'bale', 'flake'] as const;
export type FeedUnit = (typeof FEED_UNITS)[number];

// --- Animals ------------------------------------------------------------

export interface Animal {
  id: string;
  species: string;
  breed: string | null;
  name: string | null;
  tag: string | null;
  sex: AnimalSex | null;
  dob: string | null;
  status: AnimalStatus;
  pasture: string | null;
  damId: string | null;
  sireId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnimalListResponse {
  animals: Animal[];
}

export interface CreateAnimalRequest {
  species: string;
  breed?: string;
  name?: string;
  tag?: string;
  sex?: AnimalSex;
  dob?: string;
  status?: AnimalStatus;
  pasture?: string;
}

export interface UpdateAnimalRequest {
  breed?: string;
  name?: string;
  tag?: string;
  sex?: AnimalSex;
  dob?: string;
  status?: AnimalStatus;
}

export interface AnimalListFilters {
  species?: string;
  status?: AnimalStatus;
  pasture?: string;
}

// --- Lifecycle events ---------------------------------------------------

export type AnimalEventType = 'BIRTH' | 'DEATH' | 'SALE';

export interface AnimalEvent {
  type: AnimalEventType;
  ts: string;
  date: string | null;
  dob: string | null;
  cause: string | null;
  buyer: string | null;
  price: number | null;
  damId: string | null;
  sireId: string | null;
}

export interface AnimalEventsResponse {
  events: AnimalEvent[];
}

// POST /births — animal create fields plus optional parentage links.
export interface RecordBirthRequest extends CreateAnimalRequest {
  damId?: string;
  sireId?: string;
}

export interface BirthResponse {
  animal: Animal;
  event: AnimalEvent;
}

export interface RecordDeathRequest {
  date?: string;
  cause?: string;
}

export interface RecordSaleRequest {
  date?: string;
  buyer?: string;
  price?: number;
}

export interface LifecycleResponse {
  animal: Animal;
  event: AnimalEvent;
}

// --- Pastures -----------------------------------------------------------

export interface Pasture {
  id: string;
  name: string;
  acreage: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PastureListResponse {
  pastures: Pasture[];
}

export interface CreatePastureRequest {
  name: string;
  acreage?: number;
  notes?: string;
}

// An animal->pasture pointer, as returned by GET /pastures/{id}/animals.
export interface PastureAnimal {
  animalId: string;
  pastureId: string;
  movedAt: string | null;
}

export interface PastureAnimalsResponse {
  pastureId: string;
  animals: PastureAnimal[];
}

// --- Movements ----------------------------------------------------------

export interface Move {
  animalId: string;
  fromPastureId: string | null;
  toPastureId: string;
  ts: string;
  notes: string | null;
}

export interface MovesResponse {
  animalId: string;
  moves: Move[];
}

export interface MoveAnimalRequest {
  toPastureId: string;
  ts?: string;
  notes?: string;
}

// --- Feed ---------------------------------------------------------------

export interface FeedPurchase {
  id: string;
  type: string;
  quantity: number;
  unit: FeedUnit;
  // Feed purchased by the bag carries bag count + per-bag weight; the server
  // computes totalLbs (bags * bagWeightLbs). Older records may omit these.
  bags?: number;
  bagWeightLbs?: number;
  totalLbs?: number;
  cost: number;
  vendor: string;
  purchasedAt: string;
  createdAt: string;
}

export interface FeedPurchaseListResponse {
  feed_purchases: FeedPurchase[];
}

// Feed-by-the-bag purchase: bags * bagWeightLbs -> totalLbs (computed server
// side). cost and date are optional; feedType identifies the feed.
export interface CreateFeedPurchaseRequest {
  feedType: string;
  bags: number;
  bagWeightLbs: number;
  cost?: number;
  date?: string;
  // Optional flock attribution, used by per-flock egg-cost analytics.
  flock?: string;
}

export interface FeedPurchaseFilters {
  from?: string;
  to?: string;
  type?: string;
}

// --- Feed consumption ---------------------------------------------------

// A logged feed-usage event. lbs is the total feed consumed; bag-based entries
// also carry bags + per-bag weight (server computes lbs = bags * bagWeightLbs).
export interface FeedConsumption {
  id: string;
  feedType: string;
  lbs: number;
  bags?: number;
  bagWeightLbs?: number;
  date: string;
  createdAt: string;
}

export interface FeedConsumptionListResponse {
  feed_consumption: FeedConsumption[];
}

// POST /feed-consumption — record feed used. Supply either lbs directly, or
// bags + bagWeightLbs (server computes lbs). date defaults server-side to today.
export interface CreateFeedConsumptionRequest {
  feedType: string;
  lbs?: number;
  bags?: number;
  bagWeightLbs?: number;
  date?: string;
  // Optional flock attribution, used by per-flock egg-cost analytics.
  flock?: string;
}

export interface FeedConsumptionFilters {
  from?: string;
  to?: string;
  type?: string;
}

// --- Eggs ---------------------------------------------------------------

export interface EggCollection {
  id: string;
  count: number;
  date: string;
  coop: string | null;
  // Optional bird type (e.g. chicken, duck, quail) the eggs came from.
  birdType: string | null;
  createdAt: string;
}

export interface EggCollectionListResponse {
  egg_collections: EggCollection[];
}

export interface CreateEggCollectionRequest {
  count: number;
  date?: string;
  coop?: string;
  // Optional bird type (e.g. chicken, duck, quail) the eggs came from.
  birdType?: string;
  // Optional flock attribution, used by per-flock egg-cost analytics.
  flock?: string;
}

export interface EggCollectionFilters {
  from?: string;
  to?: string;
  birdType?: string;
}

// --- Stats --------------------------------------------------------------

export interface SpeciesBreakdown {
  total: number;
  active: number;
  deceased: number;
  sold: number;
}

export interface HerdStats {
  total: number;
  bySpecies: Record<string, SpeciesBreakdown>;
  byStatus: { active: number; deceased: number; sold: number };
}

export interface PastureOccupancyRow {
  pastureId: string;
  name: string | null;
  count: number;
}

export interface PastureOccupancyStats {
  total: number;
  pastures: PastureOccupancyRow[];
}

export interface LifecycleStats {
  type: 'birth' | 'death';
  months: string[];
  total: number;
}

export interface FeedTypeBreakdown {
  cost: number;
  quantity: number;
  purchases: number;
}

export interface FeedStats {
  months: string[];
  totalCost: number;
  totalQuantity: number;
  purchaseCount: number;
  byType: Record<string, FeedTypeBreakdown>;
}

// GET /stats/eggs?period= — egg production totals for a period.
export interface EggStats {
  period: string;
  totalEggs: number;
  dozens: number;
  days: number;
  perDay: number;
  // Per-bird-type production breakdown, present when collections are tagged.
  byBirdType?: EggsByBirdTypeRow[];
}

// GET /stats/egg-cost?period=&storePricePerDozen= — cost-per-dozen analytics
// comparing your poultry-feed spend against a store price.
export interface EggCostStats {
  period: string;
  eggs: number;
  dozens: number;
  poultryFeedSpend: number;
  costPerDozen: number;
  costPerEgg: number;
  storePricePerDozen: number;
  savingsPerDozen: number;
  cheaperThanStore: boolean;
  // Refined cost-per-dozen computed from logged feed *consumption* (valued at
  // average unit cost) rather than raw purchase spend. Present when usage has
  // been logged for the period.
  consumptionBasis?: EggCostConsumptionBasis;
}

// Consumption-basis cost-per-dozen: feed actually fed to the flock, valued at
// average unit cost, divided by eggs produced over the same period.
export interface EggCostConsumptionBasis {
  poultryFeedConsumedLbs: number;
  poultryFeedConsumedValue: number;
  costPerDozen: number;
  costPerEgg: number;
  savingsPerDozen: number;
  cheaperThanStore: boolean;
}

// --- Feed inventory -----------------------------------------------------

// GET /stats/feed-inventory — per-type on-hand position and burn-down forecast.
export interface FeedInventoryRow {
  feedType: string;
  purchasedLbs: number;
  consumedLbs: number;
  onHandLbs: number;
  avgUnitCost: number;
  onHandValue: number;
  burnRateLbsPerDay: number;
  daysRemaining: number | null;
  projectedRunOutDate: string | null;
}

export interface FeedInventoryTotals {
  purchasedLbs: number;
  consumedLbs: number;
  onHandLbs: number;
  onHandValue: number;
  burnRateLbsPerDay: number;
}

export interface FeedInventoryStats {
  byType: FeedInventoryRow[];
  totals: FeedInventoryTotals;
}

// GET /stats/summary — one composed dashboard payload.
export interface SummaryHerdSpecies {
  species: string;
  total: number;
  active: number;
}

export interface SummaryOccupancy {
  name: string | null;
  count: number;
}

export interface StatsSummary {
  asOf: { month: string; year: string };
  herd: {
    totalAnimals: number;
    activeAnimals: number;
    bySpecies: SummaryHerdSpecies[];
  };
  births: { thisMonth: number; thisYear: number };
  deaths: { thisMonth: number; thisYear: number };
  feed: { thisMonthSpend: number; thisMonthQuantity: number };
  eggs: { thisWeek: number; thisMonth: number };
  eggCost: { costPerDozenThisMonth: number; cheaperThanStore: boolean };
  pastures: { total: number; occupancy: SummaryOccupancy[] };
}

// --- Health expenses ----------------------------------------------------

export interface HealthExpense {
  id: string;
  category: string;
  cost: number;
  animalRef: string | null;
  note: string | null;
  date: string;
  createdAt: string;
}

export interface HealthExpenseListResponse {
  health_expenses: HealthExpense[];
}

// POST /health-expenses — log a health/vet expense. category and cost are
// required; animalRef, note, and date are optional (date defaults to today).
export interface CreateHealthExpenseRequest {
  category: string;
  cost: number;
  animalRef?: string;
  note?: string;
  date?: string;
}

export interface HealthExpenseFilters {
  from?: string;
  to?: string;
  category?: string;
}

// GET /stats/health?period= — health spend totals for a period.
export interface HealthCategoryBreakdown {
  category: string;
  cost: number;
  count: number;
}

export interface HealthPerAnimalRow {
  animalRef: string;
  cost: number;
  count: number;
}

export interface HealthStats {
  period: string;
  totalSpend: number;
  byCategory: HealthCategoryBreakdown[];
  perAnimal: HealthPerAnimalRow[];
}

// GET /stats/mortality?period= — deaths-by-cause plus an overall loss rate.
export interface MortalityCauseBreakdown {
  cause: string;
  count: number;
}

export interface MortalityStats {
  period: string;
  totalDeaths: number;
  byCause: MortalityCauseBreakdown[];
  // Fraction (0..1) of the herd lost in the period.
  lossRate: number;
}

// GET /stats/digest — a "this week" rollup with headline numbers and a set of
// human-readable summary lines.
export interface DigestMortality {
  totalDeaths: number;
  lossRate: number;
}

export interface DigestStats {
  period: string;
  eggs: number;
  feedSpend: number;
  feedOnHandLbs: number;
  daysRemaining: number | null;
  births: number;
  deaths: number;
  mortality: DigestMortality;
  lines: string[];
}

// GET /stats/egg-cost/by-flock?period= — per-flock cost-per-dozen analytics.
export interface EggCostByFlockRow {
  flock: string;
  dozens: number;
  poultryFeedSpend: number;
  costPerDozen: number;
  // Refined consumption-basis cost-per-dozen, present when usage is logged.
  consumptionBasis?: number;
}

// GET /stats/eggs?period= now includes an optional by-bird-type breakdown.
export interface EggsByBirdTypeRow {
  birdType: string;
  eggs: number;
  dozens: number;
}

// --- Milk ---------------------------------------------------------------

// A logged milking. gallons is the yield; animalRef ties it to a milker.
export interface MilkLog {
  id: string;
  animalRef: string | null;
  gallons: number;
  date: string;
  note: string | null;
  createdAt: string;
}

export interface MilkLogListResponse {
  milk_logs: MilkLog[];
}

// POST /milk-logs — record a milking. gallons is required; animalRef, note,
// and date are optional (date defaults server-side to today).
export interface CreateMilkLogRequest {
  gallons: number;
  animalRef?: string;
  note?: string;
  date?: string;
}

export interface MilkLogFilters {
  from?: string;
  to?: string;
}

// GET /stats/milk?period= — milk production totals + a per-day series.
export interface MilkDayPoint {
  date: string;
  gallons: number;
}

export interface MilkStats {
  period: string;
  totalGallons: number;
  days: number;
  perDay: number;
  byDay: MilkDayPoint[];
}

// GET /stats/milk-cost?period= — cost-per-gallon from dairy feed spend.
export interface MilkCostStats {
  period: string;
  gallons: number;
  feedSpend: number;
  costPerGallon: number;
  storePricePerGallon: number;
  savingsPerGallon: number;
  cheaperThanStore: boolean;
}

// --- Incubation & breeding ---------------------------------------------

export type IncubationStatus = 'incubating' | 'hatched' | 'cancelled';

// An incubation batch. expectedHatchDate is computed server-side from the set
// date and species incubation period when not supplied.
export interface IncubationBatch {
  id: string;
  birdType: string;
  eggsSet: number;
  setDate: string;
  expectedHatchDate: string | null;
  hatchedCount: number | null;
  hatchedDate: string | null;
  status: IncubationStatus;
  note: string | null;
  createdAt: string;
}

export interface IncubationBatchListResponse {
  incubation_batches: IncubationBatch[];
}

export interface CreateIncubationBatchRequest {
  birdType: string;
  eggsSet: number;
  setDate?: string;
  expectedHatchDate?: string;
  note?: string;
}

// PATCH /incubation-batches/{id} — record a hatch or update status.
export interface UpdateIncubationBatchRequest {
  hatchedCount?: number;
  hatchedDate?: string;
  status?: IncubationStatus;
  note?: string;
}

export interface IncubationStats {
  active: number;
  eggsIncubating: number;
  hatchedThisYear: number;
  // Average ratio (0..1) of chicks hatched to eggs set across closed batches.
  hatchRate: number;
}

// A breeding/kidding record with an expected due date.
export interface Breeding {
  id: string;
  species: string;
  damRef: string | null;
  sireRef: string | null;
  bredDate: string;
  expectedDueDate: string | null;
  note: string | null;
  createdAt: string;
}

export interface BreedingListResponse {
  breedings: Breeding[];
}

export interface CreateBreedingRequest {
  species: string;
  damRef?: string;
  sireRef?: string;
  bredDate?: string;
  expectedDueDate?: string;
  note?: string;
}

// GET /stats/breeding/upcoming — breedings with an upcoming due date.
export interface UpcomingBreedingRow {
  id: string;
  species: string;
  damRef: string | null;
  expectedDueDate: string;
  daysUntilDue: number;
}

export interface UpcomingBreedingStats {
  upcoming: UpcomingBreedingRow[];
}

// --- Grow-out -----------------------------------------------------------

export type GrowoutStatus = 'growing' | 'processed';

// A grow-out batch (e.g. meat birds) tracked from start to processing.
export interface GrowoutBatch {
  id: string;
  label: string;
  species: string;
  count: number;
  startDate: string;
  status: GrowoutStatus;
  processedDate: string | null;
  processedCount: number | null;
  note: string | null;
  createdAt: string;
}

export interface GrowoutBatchListResponse {
  growout_batches: GrowoutBatch[];
}

export interface CreateGrowoutBatchRequest {
  label: string;
  species: string;
  count: number;
  startDate?: string;
  note?: string;
}

// PATCH /growout/{id} — record processing for a batch.
export interface UpdateGrowoutBatchRequest {
  status?: GrowoutStatus;
  processedDate?: string;
  processedCount?: number;
  note?: string;
}

export interface GrowoutStats {
  activeBatches: number;
  birdsGrowing: number;
  processedThisYear: number;
}

// --- Care tasks ---------------------------------------------------------

export type CareTaskStatus = 'open' | 'done';
export type CareTaskCadence = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';

// A scheduled care task (vaccination, hoof trim, coop clean, etc.).
export interface CareTask {
  id: string;
  title: string;
  category: string | null;
  animalRef: string | null;
  cadence: CareTaskCadence;
  dueDate: string;
  status: CareTaskStatus;
  lastCompletedDate: string | null;
  note: string | null;
  createdAt: string;
}

export interface CareTaskListResponse {
  care_tasks: CareTask[];
}

export interface CreateCareTaskRequest {
  title: string;
  category?: string;
  animalRef?: string;
  cadence?: CareTaskCadence;
  dueDate?: string;
  note?: string;
}

export interface UpdateCareTaskRequest {
  title?: string;
  category?: string;
  animalRef?: string;
  cadence?: CareTaskCadence;
  dueDate?: string;
  status?: CareTaskStatus;
  note?: string;
}

export interface CareTaskFilters {
  status?: CareTaskStatus;
}

// GET /stats/care/due — tasks due now or soon.
export interface CareDueRow {
  id: string;
  title: string;
  category: string | null;
  dueDate: string;
  daysUntilDue: number;
  overdue: boolean;
}

export interface CareDueStats {
  dueCount: number;
  overdueCount: number;
  tasks: CareDueRow[];
}

// --- Sales & P&L --------------------------------------------------------

// A revenue line (eggs, meat, milk, livestock, etc.).
export interface Sale {
  id: string;
  category: string;
  amount: number;
  buyer: string | null;
  date: string;
  note: string | null;
  createdAt: string;
}

export interface SaleListResponse {
  sales: Sale[];
}

export interface CreateSaleRequest {
  category: string;
  amount: number;
  buyer?: string;
  date?: string;
  note?: string;
}

export interface SaleFilters {
  from?: string;
  to?: string;
}

// GET /stats/pnl?period= — costs vs. outputs with a net result.
export interface PnlLineRow {
  label: string;
  amount: number;
}

export interface PnlStats {
  period: string;
  totalCosts: number;
  totalRevenue: number;
  net: number;
  costs: PnlLineRow[];
  revenue: PnlLineRow[];
  // Optional estimated value of garden produce harvested in the period, when
  // the backend can value harvests. Surfaced additively in the P&L view.
  produceValue?: number;
}

// --- Garden: harvest logs ----------------------------------------------

// A logged garden harvest. quantity is in `unit` (e.g. lb, count, bunch); crop
// names the produce. cost (optional) lets the garden view compute cost/yield.
export interface HarvestLog {
  id: string;
  crop: string;
  quantity: number;
  unit: string;
  date: string;
  bedId: string | null;
  note: string | null;
  cost: number | null;
  // Estimated market value of the harvest, when the backend can value it.
  value: number | null;
  // Set when this harvest's surplus has been shared to Good Roots.
  listing: GrnListing | null;
  createdAt: string;
}

export interface HarvestLogListResponse {
  harvest_logs: HarvestLog[];
}

// POST /harvest-logs — record a harvest. crop and quantity are required; unit
// defaults server-side; date defaults to today; bedId/note/cost are optional.
export interface CreateHarvestLogRequest {
  crop: string;
  quantity: number;
  unit?: string;
  date?: string;
  bedId?: string;
  note?: string;
  cost?: number;
}

export interface HarvestLogFilters {
  from?: string;
  to?: string;
  crop?: string;
}

// --- Garden: beds -------------------------------------------------------

// A garden bed/plot. area (sq ft) is optional; location is a free-text label.
export interface Bed {
  id: string;
  name: string;
  area: number | null;
  location: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BedListResponse {
  beds: Bed[];
}

export interface CreateBedRequest {
  name: string;
  area?: number;
  location?: string;
  notes?: string;
}

export interface UpdateBedRequest {
  name?: string;
  area?: number;
  location?: string;
  notes?: string;
}

// --- Garden: plantings --------------------------------------------------

export type PlantingStatus = 'planned' | 'growing' | 'harvested' | 'failed';

// A planting of a crop in a bed, with sow/transplant/harvest dates that drive
// the planting-calendar view.
export interface Planting {
  id: string;
  crop: string;
  variety: string | null;
  bedId: string | null;
  status: PlantingStatus;
  sowDate: string | null;
  transplantDate: string | null;
  expectedHarvestDate: string | null;
  harvestDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlantingListResponse {
  plantings: Planting[];
}

export interface CreatePlantingRequest {
  crop: string;
  variety?: string;
  bedId?: string;
  status?: PlantingStatus;
  sowDate?: string;
  transplantDate?: string;
  expectedHarvestDate?: string;
  note?: string;
}

export interface UpdatePlantingRequest {
  crop?: string;
  variety?: string;
  bedId?: string;
  status?: PlantingStatus;
  sowDate?: string;
  transplantDate?: string;
  expectedHarvestDate?: string;
  harvestDate?: string;
  note?: string;
}

export interface PlantingFilters {
  bedId?: string;
  status?: PlantingStatus;
}

// --- Garden: stats ------------------------------------------------------

export interface HarvestByCropRow {
  crop: string;
  quantity: number;
  unit: string;
  harvests: number;
  // Optional economics, present when harvest costs/values are logged.
  cost?: number;
  value?: number;
}

// GET /stats/garden?period= — garden output totals plus a per-crop breakdown
// and (optional) cost/yield economics.
export interface GardenStats {
  period: string;
  totalHarvests: number;
  totalCost: number;
  totalValue: number;
  byCrop: HarvestByCropRow[];
}

// GET /garden/calendar — planting/harvest windows for a timeline view.
export interface PlantingCalendarRow {
  crop: string;
  variety: string | null;
  bedId: string | null;
  status: PlantingStatus;
  sowDate: string | null;
  transplantDate: string | null;
  expectedHarvestDate: string | null;
  harvestDate: string | null;
}

export interface PlantingCalendar {
  year: string;
  plantings: PlantingCalendarRow[];
}

// --- Good Roots Network (GRN) ------------------------------------------

export type GrnListingStatus = 'active' | 'claimed' | 'expired';

// A surplus listing shared to the Good Roots community. Mirrors the share
// created by POST /harvest-logs/{id}/publish.
export interface GrnListing {
  id: string;
  harvestLogId: string | null;
  crop: string;
  quantity: number;
  unit: string;
  status: GrnListingStatus;
  note: string | null;
  // Present once someone claims the listing.
  claimedBy: string | null;
  claimId: string | null;
  publishedAt: string;
  expiresAt: string | null;
}

export interface GrnListingsResponse {
  listings: GrnListing[];
}

// A community surplus offering discovered nearby, returned by GET /grn/discover.
export interface GrnDiscoverItem {
  id: string;
  crop: string;
  quantity: number;
  unit: string;
  note: string | null;
  homestead: string | null;
  distanceMiles: number | null;
  lat: number | null;
  lng: number | null;
  publishedAt: string;
}

export interface GrnDiscoverResponse {
  items: GrnDiscoverItem[];
}

export interface GrnDiscoverFilters {
  lat: number;
  lng: number;
  radius: number;
}

// A community "need" — produce someone is requesting, from GET /grn/requests.
export interface GrnRequest {
  id: string;
  crop: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  homestead: string | null;
  distanceMiles: number | null;
  requestedAt: string;
}

export interface GrnRequestsResponse {
  requests: GrnRequest[];
}

export type GrnClaimStatus = 'pending' | 'confirmed' | 'fulfilled' | 'cancelled';

// A claim on a community listing, from POST/GET /grn/claims.
export interface GrnClaim {
  id: string;
  listingId: string;
  crop: string;
  quantity: number | null;
  unit: string | null;
  status: GrnClaimStatus;
  note: string | null;
  createdAt: string;
}

export interface CreateGrnClaimRequest {
  listingId: string;
  quantity?: number;
  note?: string;
}
