import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState, grantMissedExtractionRewards } from '../domain/engine';
import { loadGame, saveGame } from './storage';
import { bundledCatalog } from '../domain/catalog';
afterEach(() => vi.unstubAllGlobals());
describe('Doro 先天特质更新', () => {
  it('开发旧存档同步初始属性，保留升级加点、道具成长并且不重复叠加', () => {
    const state = createInitialState();
    state.pets.doro = { ...structuredClone(bundledCatalog.petTemplates.doro),
      baseStats: { fitness: 2, perception: 2, technique: 2 },
      secondaryStats: { eloquence: 4, lore: 1, courage: 2, guile: 2 },
      level: 4, xp: 12, unspentPoints: 1, allocatedStats: { fitness: 2, perception: 1, technique: 0 } };
    const original = JSON.stringify(state);
    const store = new Map([['idle-pet-adventure.demo.v1', original]]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
    const pet = loadGame().pets.doro;
    const template = bundledCatalog.petTemplates.doro;
    expect(pet).toEqual({ ...state.pets.doro, baseStats: template.baseStats,
      secondaryStats: { ...template.secondaryStats, eloquence: template.secondaryStats.eloquence + 2, guile: template.secondaryStats.guile + 1 } });
    expect(loadGame().pets.doro).toEqual(pet);
    expect(store.get('idle-pet-adventure.demo.v1.before-doro-base-update')).toBe(original);
  });
  it('旧万人迷改为幸运儿，保留培养进度和成长特质', () => {
    const state = createInitialState();
    state.pets.doro = { ...structuredClone(bundledCatalog.petTemplates.doro), innateTagId: 'tags-heartthrob', level: 4, xp: 12, growthTagIds: ['tag-lucky'] };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(state) });
    expect(bundledCatalog.petTemplates.doro.innateTagId).toBe('tag-lucky');
    expect(loadGame().pets.doro).toEqual({ ...state.pets.doro, innateTagId: 'tag-lucky' });
  });
  it('不改动非旧默认特质，也不提前招募 Doro', () => {
    const state = createInitialState();
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(state) });
    expect(loadGame().pets.doro).toBeUndefined();
    state.pets.doro = { ...structuredClone(bundledCatalog.petTemplates.doro), innateTagId: 'custom-tag' };
    expect(loadGame().pets.doro.innateTagId).toBe('custom-tag');
  });
});
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
