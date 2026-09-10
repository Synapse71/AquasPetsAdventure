import { describe, expect, it } from 'vitest';
import { allocateStats, createInitialState, resetPetStats } from '../domain/engine';
import { emptyPoints, isStatusDrafts, previewPet, statusDraftBasis, validStatusDraft, type PetStatusDraft } from './petStatusDraft';

function fixture() {
  const game = createInitialState(), pet = Object.values(game.pets)[0];
  pet.unspentPoints = 3;
  const draft: PetStatusDraft = { basis: statusDraftBasis(game, pet), points: { fitness: 1, perception: 0, technique: 1 }, mode: 'allocate' };
  return { game, pet, draft };
}
describe('status drafts', () => {
  it('round-trips through UI storage without changing the pet', () => {
    const { game, pet, draft } = fixture(), saved = JSON.parse(JSON.stringify({ [pet.id]: draft }));
    expect(isStatusDrafts(saved)).toBe(true);
    expect(validStatusDraft(game, pet, saved[pet.id])).toEqual(draft);
    expect(previewPet(pet, draft.points).allocatedStats.fitness).toBe(pet.allocatedStats.fitness + 1);
    expect(pet.unspentPoints).toBe(3);
  });
  it('rejects stale or over-budget drafts but preserves them across injury and XP updates', () => {
    const { game, pet, draft } = fixture();
    pet.xp += 1; pet.injury = 'injured';
    expect(validStatusDraft(game, pet, draft)).toBe(draft);
    pet.unspentPoints = 1;
    expect(validStatusDraft(game, pet, draft)).toBeUndefined();
    pet.unspentPoints = 3;
    const committed = allocateStats(game, pet.id, draft.points);
    expect(validStatusDraft(committed, committed.pets[pet.id], draft)).toBeUndefined();
    const reset = resetPetStats(committed, pet.id);
    expect(validStatusDraft(reset, reset.pets[pet.id], draft)).toBeUndefined();
  });
  it('does not restore an empty or mixed reset confirmation', () => {
    const { game, pet, draft } = fixture();
    expect(validStatusDraft(game, pet, { ...draft, mode: 'reset' })).toBeUndefined();
    expect(validStatusDraft(game, pet, { ...draft, mode: 'reset', points: emptyPoints() })).toBeUndefined();
  });
  it.each([null, [], { x: { points: { fitness: -1 } } }, { x: { basis: 'x', points: emptyPoints(), mode: 'hack' } }])('rejects malformed UI storage', value => {
    expect(isStatusDrafts(value)).toBe(false);
  });
});
