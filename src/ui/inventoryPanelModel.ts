import { catalog } from '../domain/catalog';
import { itemStackSize, petTags, petSecondaryStat, secondaryStatCap } from '../domain/engine';
import { rarityRank } from '../domain/rarity';
import type { GameState, Inventory, Pet } from '../domain/types';

export type SortKey = 'value' | 'weight' | 'rarity';
export interface InventoryView {
  sort: SortKey; direction: 1 | -1; selected: string; bulk: boolean;
  picked: Inventory; expeditionId: string; cargoOpen: boolean;
}
export const initialInventoryView: InventoryView = { sort: 'value', direction: -1, selected: '', bulk: false, picked: {}, expeditionId: '', cargoOpen: false };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const positiveInventory = (v: unknown): v is Inventory => record(v) && Object.values(v).every(q => typeof q === 'number' && Number.isSafeInteger(q) && q > 0);
export function isInventoryView(v: unknown): v is InventoryView {
  return record(v) && ['value', 'weight', 'rarity'].includes(v.sort as string) && [1, -1].includes(v.direction as number)
    && typeof v.selected === 'string' && typeof v.bulk === 'boolean' && positiveInventory(v.picked)
    && typeof v.expeditionId === 'string' && typeof v.cargoOpen === 'boolean';
}
export function sortedInventory(inventory: Inventory, sort: SortKey, direction: number): [string, number][] {
  const value = (id: string) => sort === 'rarity' ? rarityRank(catalog.items[id].rarity) : sort === 'weight' ? catalog.items[id].weight : catalog.items[id].sellValue ?? 0;
  return Object.entries(inventory).filter(([id, q]) => q > 0 && Object.hasOwn(catalog.items, id))
    .sort(([a], [b]) => (value(a) - value(b)) * direction || a.localeCompare(b));
}
export function inventoryCells(entries: [string, number][]) {
  return entries.flatMap(([id, quantity]) => {
    const stack = itemStackSize(id);
    return Array.from({ length: Math.ceil(quantity / stack) }, (_, index) => ({ id, index, quantity: Math.min(stack, quantity - index * stack) }));
  });
}
export const sellable = (game: GameState, id: string) => Object.hasOwn(catalog.items, id) && catalog.items[id].sellable && !game.lockedItemIds.includes(id) && (game.inventory[id] ?? 0) > 0;
export function cleanPicked(game: GameState, picked: Inventory): Inventory {
  return Object.fromEntries(Object.entries(picked).filter(([id, q]) => sellable(game, id) && game.inventory[id] === q));
}
export const saleValue = (quantities: Inventory) => Object.entries(quantities).reduce((n, [id, q]) => n + (catalog.items[id]?.sellValue ?? 0) * q, 0);
export const itemCount = (quantities: Inventory) => Object.values(quantities).reduce((n, q) => n + q, 0);
export function saleBasis(game: GameState, quantities: Inventory): string {
  return JSON.stringify(Object.keys(quantities).sort().map(id => [id, game.inventory[id] ?? 0, game.lockedItemIds.includes(id), catalog.items[id]?.sellable, catalog.items[id]?.sellValue]));
}
export function useBasis(game: GameState, itemId: string): string {
  const item = catalog.items[itemId];
  return JSON.stringify([game.inventory[itemId] ?? 0, item?.tagGrantId, item?.secondaryGrant,
    Object.values(game.pets).map(pet => [pet.id, pet.secondaryStats, pet.innateTagId, pet.growthTagIds, pet.growthTagSlots])]);
}
export function useBlockReason(pet: Pet, itemId: string): string | undefined {
  const item = catalog.items[itemId];
  if (item?.tagGrantId) {
    if (petTags(pet).includes(item.tagGrantId)) return '已拥有该特质';
    if (pet.growthTagIds.length >= pet.growthTagSlots) return '特质槽已满';
    return;
  }
  if (item?.secondaryGrant) {
    if (petSecondaryStat(pet, item.secondaryGrant.stat) >= secondaryStatCap()) return '已达上限';
    return;
  }
  return '该物品无法使用';
}
export type InventoryDialog =
  | { type: 'sale'; quantities: Inventory; basis: string; singleId?: string }
  | { type: 'use'; itemId: string; petId: string; basis: string }
  | { type: 'discard'; expeditionId: string; itemId: string; quantity: number; basis: string }
  | { type: 'reports' };
export function isInventoryDialog(v: unknown): v is InventoryDialog | null {
  if (v === null) return true;
  if (!record(v)) return false;
  if (v.type === 'reports') return true;
  if (typeof v.basis !== 'string') return false;
  if (v.type === 'sale') return positiveInventory(v.quantities) && Object.keys(v.quantities).length > 0
    && (v.singleId === undefined || (typeof v.singleId === 'string' && Object.keys(v.quantities).length === 1 && Object.hasOwn(v.quantities, v.singleId)));
  if (v.type === 'use') return typeof v.itemId === 'string' && typeof v.petId === 'string';
  return v.type === 'discard' && typeof v.expeditionId === 'string' && typeof v.itemId === 'string' && Number.isSafeInteger(v.quantity) && (v.quantity as number) > 0;
}
export function discardBasis(game: GameState, expeditionId: string, itemId: string): string {
  const e = game.expeditions.find(e => e.id === expeditionId);
  return JSON.stringify([e?.phase, e?.currentNodeId, e?.cargo[itemId] ?? 0]);
}
export function validInventoryDialog(game: GameState, dialog: InventoryDialog | null): boolean {
  if (!dialog || dialog.type === 'reports') return true;
  if (dialog.type === 'sale') return dialog.basis === saleBasis(game, dialog.quantities)
    && Object.entries(dialog.quantities).every(([id, q]) => sellable(game, id) && q <= game.inventory[id]);
  if (dialog.type === 'use') return Object.hasOwn(catalog.items, dialog.itemId) && (game.inventory[dialog.itemId] ?? 0) > 0
    && dialog.basis === useBasis(game, dialog.itemId) && (!dialog.petId || Object.hasOwn(game.pets, dialog.petId));
  const e = game.expeditions.find(e => e.id === dialog.expeditionId);
  return !!e && ['awaiting-route', 'awaiting-event', 'extraction'].includes(e.phase)
    && (e.cargo[dialog.itemId] ?? 0) >= dialog.quantity && dialog.basis === discardBasis(game, e.id, dialog.itemId);
}
