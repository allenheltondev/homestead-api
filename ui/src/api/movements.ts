import type { ApiFetch } from '../auth/useApiFetch';
import type { Move, MoveAnimalRequest, MovesResponse } from './types';

// POST /animals/{id}/moves — record a move into a pasture.
export async function moveAnimal(
  apiFetch: ApiFetch,
  animalId: string,
  payload: MoveAnimalRequest,
): Promise<Move> {
  return apiFetch<Move>(`/animals/${animalId}/moves`, { method: 'POST', body: payload });
}

export async function listAnimalMoves(
  apiFetch: ApiFetch,
  animalId: string,
  options: { limit?: number } = {},
): Promise<MovesResponse> {
  return apiFetch<MovesResponse>(`/animals/${animalId}/moves`, {
    query: { limit: options.limit },
  });
}

export async function deleteMove(
  apiFetch: ApiFetch,
  animalId: string,
  ts: string,
): Promise<void> {
  await apiFetch<void>(`/animals/${animalId}/moves/${encodeURIComponent(ts)}`, {
    method: 'DELETE',
  });
}
