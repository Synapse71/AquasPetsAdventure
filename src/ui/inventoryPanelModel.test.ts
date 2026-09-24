import { afterEach, describe, expect, it } from 'vitest';
import { bundledCatalog, catalog, setCatalog } from '../domain/catalog';
import { createInitialState, sellWarehouseItems } from '../domain/engine';
import type { GameState } from '../domain/types';
import { cellQuantity, cellRefs, cleanPicked, discardBasis, foodHealPreview, initialInventoryView, inventoryCells, isInventoryDialog, isInventoryView, pickedQuantities, saleBasis,
  sortedInventory, usableOnPet, useBasis, useBlockReason, validInventoryDialog } from './inventoryPanelModel';

afterEach(() => setCatalog(bundledCatalog));
describe('inventory panel', () => {
  it('splits stacks into actual occupied slots without changing total quantity', () => {
    const cells = inventoryCells([['cloth-strip', 41], ['paper', 2]]);
    expect(cells.map(c => c.quantity)).toEqual([20, 20, 1, 2]);
    expect(cells.reduce((n, c) => n + c.quantity, 0)).toBe(43);
  });
  it('一格装多少只由堆叠规则决定，和排序无关', () => {
    expect(cellQuantity(46, 20, 0)).toBe(20);
    expect(cellQuantity(46, 20, 2)).toBe(6);
    expect(cellQuantity(46, 20, 3)).toBe(0);
    expect(cellRefs('cloth-strip', 46)).toEqual(['cloth-strip#0', 'cloth-strip#1', 'cloth-strip#2']);
  });
  it('sorts mythic rarity correctly, with deterministic ties', () => {
    const inventory = { 'cloth-strip': 1, 'bubugao-dianduji': 1, 'exploration-manuscripts': 1 };
    expect(sortedInventory(inventory, 'rarity', -1).map(([id]) => id)).toEqual(['bubugao-dianduji', 'exploration-manuscripts', 'cloth-strip']);
    expect(sortedInventory(inventory, 'value', 1)[0][0]).toBe('cloth-strip');
  });
  it('选中以格为单位：锁定的整格被剔除，越界的格子也剔除', () => {
    const game = createInitialState();
    game.inventory = { 'cloth-strip': 25, paper: 8 }; // 布条每格 20 → 20 / 5
    game.lockedItemIds = ['paper'];
    expect(cleanPicked(game, ['cloth-strip#0', 'cloth-strip#1', 'paper#0', 'cloth-strip#9'])).toEqual(['cloth-strip#0', 'cloth-strip#1']);
    expect(pickedQuantities(game, ['cloth-strip#1'])).toEqual({ 'cloth-strip': 5 });
    expect(pickedQuantities(game, ['cloth-strip#0', 'cloth-strip#1'])).toEqual({ 'cloth-strip': 25 });
    game.inventory['cloth-strip'] = 20;
    expect(cleanPicked(game, ['cloth-strip#0', 'cloth-strip#1'])).toEqual(['cloth-strip#0']);
  });
  it('单格售卖的数量上限就是那一格，借不到同名其它格的数量', () => {
    const game = createInitialState();
    game.inventory = { 'cloth-strip': 46 };
    const quantities = { 'cloth-strip': 21 };
    const dialog = { type: 'sale' as const, quantities, singleId: 'cloth-strip', cellIndex: 0, basis: saleBasis(game, quantities) };
    expect(validInventoryDialog(game, dialog)).toBe(false);
    expect(validInventoryDialog(game, { ...dialog, quantities: { 'cloth-strip': 20 } })).toBe(true);
    expect(validInventoryDialog(game, { ...dialog, quantities: { 'cloth-strip': 6 }, cellIndex: 2 })).toBe(true);
  });
  it('丢弃确认绑定到具体格子，超过这一格就失效', () => {
    const game = createInitialState();
    // 麻绳每格 12 → 25 件是 12 / 12 / 1 三格。
    game.expeditions = [{
      id: 'e', mapId: 'map-1', petIds: [], phase: 'awaiting-route', targetNodeId: 'm1-start', startedAt: 0, arriveAt: 0,
      cargo: { 'hemp-rope': 25 }, initialCargo: {}, arrivalLoot: {}, soldDuringExtraction: {}, soldInitialCargo: {},
      visitedNodeIds: [], drawnEventIds: [], currentSeed: 1, completedNodeCount: 0,
    }] as GameState['expeditions'];
    const basis = discardBasis(game, 'e', 'hemp-rope');
    const discard = (quantity: number, cellIndex: number) => ({ type: 'discard' as const, expeditionId: 'e', itemId: 'hemp-rope', quantity, cellIndex, basis });
    expect(validInventoryDialog(game, discard(12, 0))).toBe(true);
    expect(validInventoryDialog(game, discard(13, 0))).toBe(false);
    expect(validInventoryDialog(game, discard(1, 2))).toBe(true);
    expect(validInventoryDialog(game, discard(2, 2))).toBe(false);
  });
  it('preserves a pending sale through reload, but never replays a committed sale', () => {
    const game = createInitialState();
    game.inventory = { 'cloth-strip': 4 };
    const quantities = { 'cloth-strip': 2 };
    const dialog = { type: 'sale' as const, quantities, basis: saleBasis(game, quantities) };
    expect(validInventoryDialog(game, JSON.parse(JSON.stringify(dialog)))).toBe(true);
    const sold = sellWarehouseItems(game, quantities);
    expect(validInventoryDialog(sold, dialog)).toBe(false);
    const locked = { ...game, lockedItemIds: ['cloth-strip'] };
    expect(validInventoryDialog(locked, dialog)).toBe(false);
  });
  it('invalidates a quote if configured prices change', () => {
    const game = createInitialState(); game.inventory = { paper: 4 };
    const quantities = { paper: 2 }, dialog = { type: 'sale' as const, quantities, basis: saleBasis(game, quantities) };
    setCatalog({ ...catalog, items: { ...catalog.items, paper: { ...catalog.items.paper, sellValue: 999 } } });
    expect(validInventoryDialog(game, dialog)).toBe(false);
  });
  it('validates growth previews and rejects a stale use confirmation', () => {
    const game = createInitialState(), pet = Object.values(game.pets)[0];
    const id = 'bubugao-dianduji'; game.inventory = { [id]: 2 };
    pet.secondaryStats.lore = 19;
    const dialog = { type: 'use' as const, itemId: id, petId: pet.id, basis: useBasis(game, id) };
    expect(useBlockReason(pet, id)).toBeUndefined();
    expect(validInventoryDialog(game, dialog)).toBe(true);
    pet.secondaryStats.lore = 20;
    expect(useBlockReason(pet, id)).toBe('已达上限');
    expect(validInventoryDialog(game, dialog)).toBe(false);
  });
  it('prevents duplicate or over-capacity trait grants', () => {
    setCatalog({ ...catalog, items: { ...catalog.items, test: { ...catalog.items.paper, id: 'test', tagGrantId: 'lucky' } } });
    const pet = Object.values(createInitialState().pets)[0];
    pet.growthTagIds = [];
    expect(useBlockReason(pet, 'test')).toBeUndefined();
    pet.growthTagIds = ['lucky'];
    expect(useBlockReason(pet, 'test')).toBe('已拥有该特质');
    pet.growthTagIds = ['other', 'third'];
    expect(useBlockReason(pet, 'test')).toBe('特质槽已满');
  });
  it('rejects malformed restored UI data', () => {
    expect(isInventoryView(initialInventoryView)).toBe(true);
    expect(isInventoryView({ ...initialInventoryView, picked: ['cloth-strip#0', 'cloth-strip#2'] })).toBe(true);
    expect(isInventoryView({ ...initialInventoryView, picked: { paper: -1 } })).toBe(false);
    expect(isInventoryView({ ...initialInventoryView, picked: ['paper'] })).toBe(false);
    expect(isInventoryView({ ...initialInventoryView, cell: -1 })).toBe(false);
    expect(isInventoryDialog({ type: 'sale', quantities: {}, basis: '' })).toBe(false);
    expect(isInventoryDialog({ type: 'sale', quantities: { paper: 2 }, singleId: 'paper', basis: '' })).toBe(false);
    expect(isInventoryDialog({ type: 'sale', quantities: { paper: 2 }, singleId: 'paper', cellIndex: 0, basis: '' })).toBe(true);
    expect(isInventoryDialog({ type: 'discard', quantity: 0.5, itemId: 'paper', expeditionId: 'e', basis: '' })).toBe(false);
    expect(isInventoryDialog({ type: 'discard', quantity: 1, itemId: 'paper', expeditionId: 'e', cellIndex: -1, basis: '' })).toBe(false);
  });
});

describe('仓库里用食物治疗', () => {
  /** 先清空再声明：要测的是「纯治疗」和「纯 buff」两种形状，不能被配表叠加影响。 */
  function fed() {
    const next = structuredClone(bundledCatalog);
    for (const item of Object.values(next.items)) { delete item.foodBuff; delete item.foodHeal; }
    next.items['canned-food'].foodHeal = { steps: 1 };
    next.items.chocolate.foodBuff = { stat: 'fitness', amount: 2 };
    setCatalog(next);
    return next;
  }

  it('带治疗效果的食物出现在「使用」入口，只加主属性的不出现', () => {
    fed();
    // 只有 buff 的食物在基地用不上——buff 要挂在远征上，入口在行前整备
    expect(usableOnPet('canned-food')).toBe(true);
    expect(usableOnPet('chocolate')).toBe(false);
    expect(usableOnPet('paper')).toBe(false);
  });

  it('没受伤、或正在冒险途中都拦下来', () => {
    fed();
    const game = createInitialState();
    const pet = game.pets.gugugaga;
    expect(useBlockReason(pet, 'canned-food', game)).toBe('没有受伤');

    const hurt = { ...game, pets: { gugugaga: { ...pet, injury: 'injured' as const } } };
    expect(useBlockReason(hurt.pets.gugugaga, 'canned-food', hurt)).toBeUndefined();

    const away = { ...hurt, expeditions: [{ petIds: ['gugugaga'] }] } as unknown as typeof game;
    expect(useBlockReason(away.pets.gugugaga, 'canned-food', away)).toBe('正在冒险途中');
  });

  it('伤势和出勤状态进 basis，变了就让确认框失效', () => {
    fed();
    const game = createInitialState();
    game.inventory = { 'canned-food': 1 };
    const before = useBasis(game, 'canned-food');
    const hurt = { ...game, pets: { gugugaga: { ...game.pets.gugugaga, injury: 'injured' as const } } };
    expect(useBasis(hurt, 'canned-food')).not.toBe(before);
    const away = { ...game, expeditions: [{ petIds: ['gugugaga'] }] } as unknown as typeof game;
    expect(useBasis(away, 'canned-food')).not.toBe(before);
  });

  it('预告按档走，不会越过正常', () => {
    const pet = { injury: 'incapacitated' as const } as never;
    expect(foodHealPreview(pet, 1)).toBe('失能 → 受伤');
    expect(foodHealPreview(pet, 2)).toBe('失能 → 正常');
    expect(foodHealPreview(pet, 9)).toBe('失能 → 正常');
  });
});
