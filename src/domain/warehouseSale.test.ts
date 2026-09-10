import { describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import { createInitialState, sellWarehouseItems } from './engine';

describe('warehouse batch sale', () => {
  const ids = Object.values(catalog.items).filter(item => item.sellable).slice(0, 2).map(item => item.id);
  it('sells the whole selection in one transaction without changing acquisition counts', () => {
    const state = createInitialState();
    state.inventory = { [ids[0]]: 3, [ids[1]]: 2 };
    const result = sellWarehouseItems(state, { [ids[0]]: 2, [ids[1]]: 2 });
    expect(result.inventory).toEqual({ [ids[0]]: 1 });
    expect(result.currency).toBe(state.currency + ids.reduce((n, id) => n + catalog.items[id].sellValue! * 2, 0));
    expect(result.itemAcquisitionCounts).toEqual(state.itemAcquisitionCounts);
    expect(state.inventory).toEqual({ [ids[0]]: 3, [ids[1]]: 2 });
  });
  it('rejects the entire batch when a later item is locked, missing, or insufficient', () => {
    const state = createInitialState();
    state.inventory = { [ids[0]]: 3, [ids[1]]: 2 };
    state.lockedItemIds = [ids[1]];
    const original = structuredClone(state);
    expect(() => sellWarehouseItems(state, { [ids[0]]: 2, [ids[1]]: 1 })).toThrow('锁定');
    expect(() => sellWarehouseItems(state, { [ids[0]]: 2, missing: 1 })).toThrow('不可出售');
    expect(() => sellWarehouseItems(state, { [ids[0]]: 4 })).toThrow('不足');
    expect(state).toEqual(original);
  });
  it('rejects invalid quantities and unsellable items', () => {
    const state = createInitialState();
    const unsellable = { ...catalog.items[ids[1]], sellable: false };
    const custom = { ...catalog, items: { ...catalog.items, [unsellable.id]: unsellable } };
    state.inventory = { [ids[0]]: 10, [unsellable.id]: 1 };
    for (const quantity of [0, -1, 0.5, NaN, Infinity]) {
      expect(() => sellWarehouseItems(state, { [ids[0]]: quantity })).toThrow('正整数');
    }
    expect(() => sellWarehouseItems(state, {})).toThrow('选择');
    expect(() => sellWarehouseItems(state, { [unsellable.id]: 1 }, custom)).toThrow('不可出售');
  });
});
