import { catalog } from '../domain/catalog';
import { INJURY_LABELS, itemStackSize, petTags, petSecondaryStat, secondaryStatCap } from '../domain/engine';
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
/** 仓库里能对宠物使用的物品：赋予特质、次要属性成长，以及带治疗效果的食物。
 *  只加主属性的食物在基地用不上——buff 要挂在远征上，所以它的入口在行前整备。 */
export const usableOnPet = (itemId: string) => {
  const item = catalog.items[itemId];
  return Boolean(item?.tagGrantId || item?.secondaryGrant || item?.foodHeal);
};
export function useBasis(game: GameState, itemId: string): string {
  const item = catalog.items[itemId];
  return JSON.stringify([game.inventory[itemId] ?? 0, item?.tagGrantId, item?.secondaryGrant, item?.foodHeal,
    // 伤势和出勤状态会决定食物治疗能不能用，变了就要让确认框失效。
    game.expeditions.flatMap(e => e.petIds),
    Object.values(game.pets).map(pet => [pet.id, pet.secondaryStats, pet.innateTagId, pet.growthTagIds, pet.growthTagSlots, pet.injury])]);
}
export function useBlockReason(pet: Pet, itemId: string, game?: GameState): string | undefined {
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
  if (item?.foodHeal) {
    if (pet.injury === 'healthy') return '没有受伤';
    // 出门在外的只能在节点上吃背包里的食物，和花钱治疗一样，基地这条路走不通。
    if (game?.expeditions.some(e => e.petIds.includes(pet.id))) return '正在冒险途中';
    return;
  }
  return '该物品无法使用';
}
/** 吃下这份食物后伤势会好转到哪一档。 */
export function foodHealPreview(pet: Pet, steps: number): string {
  const order = ['healthy', 'injured', 'incapacitated'] as const;
  const next = order[Math.max(0, order.indexOf(pet.injury) - Math.max(1, steps))];
  return `${INJURY_LABELS[pet.injury]} → ${INJURY_LABELS[next]}`;
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
