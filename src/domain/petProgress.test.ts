import { describe, expect, it } from 'vitest';
import { allocateStats, createInitialState, petEffectiveStats, petCarryCapacity, petSlotCapacity, petStatResetCost, resetPetStats } from './engine';
import type { Stats } from './types';

function fixture() {
  const state = createInitialState();
  const pet = Object.values(state.pets)[0];
  pet.baseStats = { fitness: 2, perception: 2, technique: 2 };
  pet.allocatedStats = { fitness: 0, perception: 0, technique: 0 };
  pet.unspentPoints = 4;
  return { state, pet };
}
describe('pet attribute transactions', () => {
  it('allocates a full plan atomically without mutating the source', () => {
    const { state, pet } = fixture();
    const next = allocateStats(state, pet.id, { fitness: 2, perception: 1, technique: 1 });
    expect(next.pets[pet.id].allocatedStats).toEqual({ fitness: 2, perception: 1, technique: 1 });
    expect(next.pets[pet.id].unspentPoints).toBe(0);
    expect(pet.unspentPoints).toBe(4);
    expect(pet.allocatedStats.fitness).toBe(0);
  });
  it.each([-1, 0.5, NaN, Infinity, 5])('rejects invalid or over-budget allocation %s', value => {
    const { state, pet } = fixture();
    const before = structuredClone(state);
    expect(() => allocateStats(state, pet.id, { fitness: value, perception: 0, technique: 0 })).toThrow();
    expect(state).toEqual(before);
  });
  it('rejects empty, unknown or incomplete plans', () => {
    const { state, pet } = fixture();
    for (const plan of [{ fitness: 0, perception: 0, technique: 0 }, { fitness: 1 },
      { fitness: 1, perception: 0, technique: 0, luck: 1 }]) {
      expect(() => allocateStats(state, pet.id, plan as Stats)).toThrow();
    }
    expect(() => allocateStats(state, 'missing', { fitness: 1, perception: 0, technique: 0 })).toThrow();
  });
  it('uses the save-wide increasing reset fee, even when alternating pets', () => {
    let { state, pet } = fixture();
    const other = structuredClone(pet); other.id = 'second'; state.pets[other.id] = other;
    state.currency = 200_000;
    for (const [index, cost] of [0, 500, 2000, 10000, 30000, 30000].entries()) {
      const id = index % 2 ? other.id : pet.id;
      state = allocateStats(state, id, { fitness: 1, perception: 0, technique: 0 });
      expect(petStatResetCost(state)).toBe(cost);
      const before = state.currency;
      state = resetPetStats(state, id, index);
      expect(state.currency).toBe(before - cost);
      expect(state.statResetCount).toBe(index + 1);
      expect(state.pets[id].unspentPoints).toBe(4);
      expect(state.pets[id].baseStats).toEqual(pet.baseStats);
    }
  });
  it('rejects no-op, insufficient funds, stale confirmation and missing pet without charging', () => {
    const { state, pet } = fixture();
    expect(() => resetPetStats(state, pet.id)).toThrow();
    const allocated = allocateStats(state, pet.id, { fitness: 1, perception: 0, technique: 0 });
    allocated.statResetCount = 1;
    const before = structuredClone(allocated);
    expect(() => resetPetStats(allocated, pet.id)).toThrow('通用货币不足');
    expect(() => resetPetStats(allocated, pet.id, 0)).toThrow('费用已变化');
    expect(() => resetPetStats(allocated, 'missing')).toThrow('宠物不存在');
    expect(allocated).toEqual(before);
  });
  it('uses engine-derived effective values, without reducing personal secondary stats or slots', () => {
    const { pet } = fixture();
    pet.injury = 'injured';
    expect(petEffectiveStats(pet)).toEqual({ fitness: 1, perception: 1, technique: 1 });
    expect(petCarryCapacity(pet)).toBe(5.6);
    expect(petSlotCapacity(pet)).toBe(10);
    pet.injury = 'incapacitated';
    expect(petEffectiveStats(pet)).toEqual({ fitness: 0, perception: 0, technique: 0 });
    expect(petCarryCapacity(pet)).toBe(0);
    expect(petSlotCapacity(pet)).toBe(10);
  });
});
