import type { GameState, Pet, Stats } from '../domain/types';

export const PRIMARY_KEYS = ['fitness', 'perception', 'technique'] as const;
export const emptyPoints = (): Stats => ({ fitness: 0, perception: 0, technique: 0 });
export const pointCount = (points: Stats) => PRIMARY_KEYS.reduce((sum, key) => sum + points[key], 0);
export interface PetStatusDraft { basis: string; points: Stats; mode: 'allocate' | 'reset' }
export type PetStatusDrafts = Record<string, PetStatusDraft>;

// Injury, time and XP changes do not invalidate a plan. Actual allocation or a
// save-wide reset does: this also prevents replay after a crash during commit.
export function statusDraftBasis(game: GameState, pet: Pet): string {
  return JSON.stringify([pet.id, ...PRIMARY_KEYS.map(key => pet.baseStats[key]),
    ...PRIMARY_KEYS.map(key => pet.allocatedStats[key]), game.statResetCount]);
}
export function isStatusDrafts(value: unknown): value is PetStatusDrafts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(d => d && typeof d.basis === 'string' &&
    (d.mode === 'allocate' || d.mode === 'reset') && d.points &&
    Object.keys(d.points).length === 3 && PRIMARY_KEYS.every(key => Number.isSafeInteger(d.points[key]) && d.points[key] >= 0));
}
export function validStatusDraft(game: GameState, pet: Pet, draft?: PetStatusDraft): PetStatusDraft | undefined {
  if (!draft || !isStatusDrafts({ draft }) || draft.basis !== statusDraftBasis(game, pet)) return;
  const total = pointCount(draft.points);
  if (!Number.isSafeInteger(total) || total > pet.unspentPoints) return;
  if (draft.mode === 'reset' && (total > 0 || pointCount(pet.allocatedStats) === 0)) return;
  return draft;
}
export function previewPet(pet: Pet, points: Stats): Pet {
  return { ...pet, allocatedStats: {
    fitness: pet.allocatedStats.fitness + points.fitness,
    perception: pet.allocatedStats.perception + points.perception,
    technique: pet.allocatedStats.technique + points.technique,
  } };
}
