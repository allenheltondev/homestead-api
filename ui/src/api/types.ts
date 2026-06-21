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
  cost: number;
  vendor: string;
  purchasedAt: string;
  createdAt: string;
}

export interface FeedPurchaseListResponse {
  feed_purchases: FeedPurchase[];
}

export interface CreateFeedPurchaseRequest {
  type: string;
  quantity: number;
  unit: FeedUnit;
  cost: number;
  vendor: string;
  purchasedAt?: string;
}

export interface FeedPurchaseFilters {
  from?: string;
  to?: string;
  type?: string;
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
  pastures: { total: number; occupancy: SummaryOccupancy[] };
}
