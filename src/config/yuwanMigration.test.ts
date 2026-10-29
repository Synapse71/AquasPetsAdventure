import oldPositions from '../domain/yuwan-layout.positions.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundledCatalog, setCatalog } from '../domain/catalog';
import { createInitialState, startExpedition } from '../domain/engine';
import { loadGame, saveGame } from '../persistence/storage';
import { initializeCatalog, loadCatalogDraft } from './catalogStore';

function storage(initial: [string, string][] = []) {
  const store = new Map(initial);
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
  return store;
}
afterEach(() => { vi.unstubAllGlobals(); setCatalog(bundledCatalog); });
describe('榆湾旧配置与存档兼容', () => {
  it.each(['draft', 'published'])('增量补入旧 %s，不覆盖已有策划修改；迁移只执行一次', source => {
    const data = structuredClone(bundledCatalog);
    delete data.maps['map-3'];
    delete data.tasks['tasks-pass-map-2'].reward.unlockMapIds;
    delete data.gachas.daily.budgets['map-3'];
    data.maps['map-2'].name = '策划修改的名字';
    data.gachas.daily.budgets['map-2'].currency = 123;
    const key = `idle-pet-adventure.catalog.${source}.v6`;
    const store = storage([[key, JSON.stringify(data)]]);
    const migrated = source === 'draft' ? loadCatalogDraft().catalog : initializeCatalog();
    expect(migrated.maps['map-3']).toEqual(bundledCatalog.maps['map-3']);
    expect(migrated.maps['map-2'].name).toBe('策划修改的名字');
    expect(migrated.gachas.daily.budgets['map-3'].currency).toBe(123);
    expect(migrated.tasks['tasks-pass-map-2'].reward.unlockMapIds).toEqual(['map-3']);
    // 后续用户主动删除地图并清除引用，不会再被迁移恢复。
    store.set(key, JSON.stringify(data));
    const reread = source === 'draft' ? loadCatalogDraft().catalog : initializeCatalog();
    expect(reread.maps['map-3']).toBeUndefined();
  });

  it.each(['draft', 'published'])('旧 %s 锚点迁移到 B，保留手调位置和节点配置且只执行一次', source => {
    const data = structuredClone(bundledCatalog);
    const map = data.maps['map-3'];
    map.nodePositions = structuredClone(oldPositions);
    map.nodePositions['m3-a1'] = { x: 31, y: 67 };
    map.aspectRatio = 1500 / 1460;
    map.nodes['m3-b1'].name = '策划改名';
    const key = `idle-pet-adventure.catalog.${source}.v6`;
    const store = storage([[key, JSON.stringify(data)], [`${key}.yuwan-v1`, '1']]);
    const load = () => source === 'draft' ? loadCatalogDraft().catalog : initializeCatalog();
    const migrated = load().maps['map-3'];
    expect(migrated.nodePositions!['m3-s1']).toEqual(bundledCatalog.maps['map-3'].nodePositions!['m3-s1']);
    expect(migrated.nodePositions!['m3-a1']).toEqual({ x: 31, y: 67 });
    expect(migrated.nodes).toEqual(map.nodes);
    expect(migrated.aspectRatio).toBe(2080 / 2016);
    store.set(key, JSON.stringify(data));
    expect(load().maps['map-3'].nodePositions).toEqual(map.nodePositions);
  });

  it('已经完成任务的存档补解锁，保留资产且重复读档不重复解锁', () => {
    storage();
    const old = createInitialState();
    old.completedTaskIds.push('tasks-pass-map-1', 'tasks-pass-map-2');
    old.unlockedMapIds.push('map-2');
    saveGame(old);
    const loaded = loadGame();
    expect(loaded.unlockedMapIds).toEqual(['map-1', 'map-2', 'map-3']);
    expect(loaded.currency).toBe(old.currency);
    expect(loaded.inventory).toEqual(old.inventory);
    saveGame(loaded);
    expect(loadGame()).toEqual(loaded);
  });

  it('第二入口的行进状态在保存加载后保留', () => {
    storage();
    const state = createInitialState();
    state.unlockedMapIds.push('map-3');
    const next = startExpedition(state, { mapId: 'map-3', startNodeId: 'm3-s2', petIds: [Object.keys(state.pets)[0]] }, 1000);
    saveGame(next);
    expect(loadGame().expeditions[0].targetNodeId).toBe('m3-s2');
  });
});
