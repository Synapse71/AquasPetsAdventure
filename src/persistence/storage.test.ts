import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState, grantMissedExtractionRewards } from '../domain/engine';
import { loadGame, saveGame } from './storage';
afterEach(() => vi.unstubAllGlobals());
describe('stat reset counter migration', () => {
  it('preserves an old save and starts unknown reset history at zero', () => {
    const state = createInitialState(); state.currency = 1234;
    const legacy = { ...state } as Partial<typeof state>; delete legacy.statResetCount;
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(legacy) });
    expect(loadGame()).toEqual(state);
  });
  it('retains a real save-wide counter on round trip', () => {
    let raw = '';
    vi.stubGlobal('localStorage', { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } });
    const state = createInitialState(); state.statResetCount = 6;
    saveGame(state);
    expect(loadGame().statResetCount).toBe(6);
  });
});

describe('v9 → v10 首次撤离奖励记录', () => {
  it('撤离过的撤离点：得到过的奖励算已领，从没得到过的留给补发', () => {
    const state = createInitialState();
    const legacy = { ...state, version: 9, completedExtractionNodeKeys: ['map-1:m1-goal-1', 'map-2:m2-goal-1'], itemAcquisitionCounts: { 'ancient-coin': 1 } } as Partial<typeof state>;
    delete legacy.claimedExtractionRewards;
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(legacy) });
    const loaded = loadGame();
    expect(loaded.version).toBe(10);
    // 克格纳的古钱币当年就领了；北山驿站的白鼬卡是通关之后才加的，没有记录，读档后会补发。
    expect(loaded.claimedExtractionRewards).toEqual({ 'map-1:m1-goal-1': { 'ancient-coin': 1 } });
    const { granted } = grantMissedExtractionRewards(loaded, 1_000);
    expect(granted).toEqual({ 'card-stoat': 1 });
  });
});
