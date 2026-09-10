import { afterEach, describe, expect, it } from 'vitest';
import { bundledCatalog, catalog, setCatalog } from '../domain/catalog';
import { createInitialState, sellWarehouseItems } from '../domain/engine';
import { cleanPicked, initialInventoryView, inventoryCells, isInventoryDialog, isInventoryView, saleBasis,
  sortedInventory, useBasis, useBlockReason, validInventoryDialog } from './inventoryPanelModel';

afterEach(() => setCatalog(bundledCatalog));
describe('inventory panel', () => {
  it('splits stacks into actual occupied slots without changing total quantity', () => {
    const cells = inventoryCells([['cloth-strip', 41], ['paper', 2]]);
    expect(cells.map(c => c.quantity)).toEqual([20, 20, 1, 2]);
    expect(cells.reduce((n, c) => n + c.quantity, 0)).toBe(43);
  });
  it('sorts mythic rarity correctly, with deterministic ties', () => {
    const inventory = { 'cloth-strip': 1, 'bubugao-dianduji': 1, 'exploration-manuscripts': 1 };
    expect(sortedInventory(inventory, 'rarity', -1).map(([id]) => id)).toEqual(['bubugao-dianduji', 'exploration-manuscripts', 'cloth-strip']);
    expect(sortedInventory(inventory, 'value', 1)[0][0]).toBe('cloth-strip');
  });
  it('removes locks and changed quantities from a saved bulk selection', () => {
    const game = createInitialState();
    game.inventory = { 'cloth-strip': 4, paper: 8 };
    game.lockedItemIds = ['paper'];
    expect(cleanPicked(game, { 'cloth-strip': 4, paper: 8 })).toEqual({ 'cloth-strip': 4 });
    game.inventory['cloth-strip']++;
    expect(cleanPicked(game, { 'cloth-strip': 4 })).toEqual({});
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
    expect(isInventoryView({ ...initialInventoryView, picked: { paper: -1 } })).toBe(false);
    expect(isInventoryDialog({ type: 'sale', quantities: {}, basis: '' })).toBe(false);
    expect(isInventoryDialog({ type: 'discard', quantity: 0.5, itemId: 'paper', expeditionId: 'e', basis: '' })).toBe(false);
  });
});
