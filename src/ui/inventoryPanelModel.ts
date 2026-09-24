import { catalog } from '../domain/catalog';
import { INJURY_LABELS, itemStackSize, petTags, petSecondaryStat, secondaryStatCap } from '../domain/engine';
import { rarityRank } from '../domain/rarity';
import type { GameState, Inventory, Pet } from '../domain/types';

export type SortKey = 'value' | 'weight' | 'rarity';
/** 一格的稳定标识：`${itemId}#${stackIndex}`。堆叠规则决定第 index 格装几件，
 *  所以同一格在重新排序后指向的仍然是同一件事——选中粒度是格，不是物品种类。 */
export type CellRef = string;
export interface InventoryView {
  sort: SortKey; direction: 1 | -1; selected: string; cell: number; bulk: boolean;
  picked: CellRef[]; expeditionId: string; cargoOpen: boolean;
}
export const initialInventoryView: InventoryView = { sort: 'value', direction: -1, selected: '', cell: 0, bulk: false, picked: [], expeditionId: '', cargoOpen: false };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const positiveInventory = (v: unknown): v is Inventory => record(v) && Object.values(v).every(q => typeof q === 'number' && Number.isSafeInteger(q) && q > 0);
export const cellRef = (id: string, index: number): CellRef => `${id}#${index}`;
export function parseCellRef(ref: string): { id: string; index: number } | undefined {
  const at = ref.lastIndexOf('#');
  const index = Number(ref.slice(at + 1));
  return at > 0 && Number.isSafeInteger(index) && index >= 0 ? { id: ref.slice(0, at), index } : undefined;
}
/** 一格最多装几件：前面都是堆满的格子，最后一格是余数。 */
export const cellQuantity = (total: number, stack: number, index: number) => Math.max(0, Math.min(stack, total - index * stack));
export const cellRefs = (id: string, quantity: number): CellRef[] =>
  Array.from({ length: Math.ceil(quantity / itemStackSize(id)) }, (_, index) => cellRef(id, index));
/** 把选中的格子合回「物品 → 数量」，引擎只认这一层。 */
export function pickedQuantities(game: GameState, picked: readonly CellRef[]): Inventory {
  const quantities: Inventory = {};
  for (const ref of picked) {
    const id = cellId(game, ref);
    if (!id) continue;
    quantities[id] = (quantities[id] ?? 0) + cellQuantity(game.inventory[id], itemStackSize(id), parseCellRef(ref)!.index);
  }
  return quantities;
}
/** 选中格子对应的可售物品；格子越界、物品不可售或已锁定时返回 undefined。 */
function cellId(game: GameState, ref: CellRef): string | undefined {
  const cell = parseCellRef(ref);
  if (!cell || !sellable(game, cell.id)) return undefined;
  return cellQuantity(game.inventory[cell.id], itemStackSize(cell.id), cell.index) > 0 ? cell.id : undefined;
}
export function isInventoryView(v: unknown): v is InventoryView {
  return record(v) && ['value', 'weight', 'rarity'].includes(v.sort as string) && [1, -1].includes(v.direction as number)
    && typeof v.selected === 'string' && Number.isSafeInteger(v.cell) && (v.cell as number) >= 0 && typeof v.bulk === 'boolean'
    && Array.isArray(v.picked) && v.picked.every(ref => typeof ref === 'string' && !!parseCellRef(ref))
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
/** 保存下来的选中格子只保留仍然成立的那些：物品还在、可售、没被锁定，且这一格还有内容。 */
export function cleanPicked(game: GameState, picked: readonly CellRef[]): CellRef[] {
  return [...new Set(picked)].filter(ref => !!cellId(game, ref));
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
  | { type: 'sale'; quantities: Inventory; basis: string; singleId?: string; cellIndex?: number }
  | { type: 'use'; itemId: string; petId: string; basis: string }
  | { type: 'discard'; expeditionId: string; itemId: string; quantity: number; cellIndex: number; basis: string }
  | { type: 'reports' };
export function isInventoryDialog(v: unknown): v is InventoryDialog | null {
  if (v === null) return true;
  if (!record(v)) return false;
  if (v.type === 'reports') return true;
  if (typeof v.basis !== 'string') return false;
  const cellIndex = v.cellIndex;
  if (v.type === 'sale') return positiveInventory(v.quantities) && Object.keys(v.quantities).length > 0
    && (v.singleId === undefined && cellIndex === undefined
      || typeof v.singleId === 'string' && Object.keys(v.quantities).length === 1 && Object.hasOwn(v.quantities, v.singleId)
        && Number.isSafeInteger(cellIndex) && (cellIndex as number) >= 0);
  if (v.type === 'use') return typeof v.itemId === 'string' && typeof v.petId === 'string' && cellIndex === undefined;
  return v.type === 'discard' && typeof v.expeditionId === 'string' && typeof v.itemId === 'string'
    && Number.isSafeInteger(v.quantity) && (v.quantity as number) > 0
    && Number.isSafeInteger(cellIndex) && (cellIndex as number) >= 0;
}
export function discardBasis(game: GameState, expeditionId: string, itemId: string): string {
  const e = game.expeditions.find(e => e.id === expeditionId);
  return JSON.stringify([e?.phase, e?.currentNodeId, e?.cargo[itemId] ?? 0]);
}
/** 单格上限：售卖数量、丢弃数量都不得超过玩家点的那一格。 */
export function cellLimit(total: number | undefined, itemId: string, cellIndex: number): number {
  return cellQuantity(total ?? 0, itemStackSize(itemId), cellIndex);
}
export function validInventoryDialog(game: GameState, dialog: InventoryDialog | null): boolean {
  if (!dialog || dialog.type === 'reports') return true;
  if (dialog.type === 'sale') return dialog.basis === saleBasis(game, dialog.quantities)
    && Object.entries(dialog.quantities).every(([id, q]) => sellable(game, id) && q <= game.inventory[id]
      && (id !== dialog.singleId || q <= cellLimit(game.inventory[id], id, dialog.cellIndex ?? 0)));
  if (dialog.type === 'use') return Object.hasOwn(catalog.items, dialog.itemId) && (game.inventory[dialog.itemId] ?? 0) > 0
    && dialog.basis === useBasis(game, dialog.itemId) && (!dialog.petId || Object.hasOwn(game.pets, dialog.petId));
  const e = game.expeditions.find(e => e.id === dialog.expeditionId);
  return !!e && ['awaiting-route', 'awaiting-event', 'extraction'].includes(e.phase)
    && (e.cargo[dialog.itemId] ?? 0) >= dialog.quantity && dialog.quantity <= cellLimit(e.cargo[dialog.itemId], dialog.itemId, dialog.cellIndex)
    && dialog.basis === discardBasis(game, e.id, dialog.itemId);
}
