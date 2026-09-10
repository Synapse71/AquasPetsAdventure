import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../domain/engine';
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
