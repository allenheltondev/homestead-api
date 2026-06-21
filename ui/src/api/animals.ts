import type { ApiFetch } from '../auth/useApiFetch';
import type {
  Animal,
  AnimalListFilters,
  AnimalListResponse,
  CreateAnimalRequest,
  UpdateAnimalRequest,
} from './types';

export async function listAnimals(
  apiFetch: ApiFetch,
  filters: AnimalListFilters = {},
): Promise<AnimalListResponse> {
  return apiFetch<AnimalListResponse>('/animals', {
    query: {
      species: filters.species,
      status: filters.status,
      pasture: filters.pasture,
    },
  });
}

export async function getAnimal(apiFetch: ApiFetch, id: string): Promise<Animal> {
  return apiFetch<Animal>(`/animals/${id}`);
}

export async function createAnimal(
  apiFetch: ApiFetch,
  payload: CreateAnimalRequest,
): Promise<Animal> {
  return apiFetch<Animal>('/animals', { method: 'POST', body: payload });
}

export async function updateAnimal(
  apiFetch: ApiFetch,
  id: string,
  payload: UpdateAnimalRequest,
): Promise<Animal> {
  return apiFetch<Animal>(`/animals/${id}`, { method: 'PATCH', body: payload });
}

export async function deleteAnimal(apiFetch: ApiFetch, id: string): Promise<void> {
  await apiFetch<void>(`/animals/${id}`, { method: 'DELETE' });
}
