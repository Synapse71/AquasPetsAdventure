import type { GameState, ItemDefinition } from '../domain/types';
import { compareRarity, isRarity, RARITIES, RARITY_LABELS, type Rarity } from '../domain/rarity';

/** 图鉴物品页顶部的筛选：所有物品、六档稀有度、收集品。 */
export type CodexFilter = 'all' | Rarity | 'collectible';
export const CODEX_FILTERS: readonly CodexFilter[] = ['all', ...RARITIES, 'collectible'];
export const CODEX_FILTER_LABELS: Record<CodexFilter, string> = { all: '所有物品', ...RARITY_LABELS, collectible: '收集品' };
export const isCodexFilter = (value: unknown): value is CodexFilter => value === 'all' || value === 'collectible' || isRarity(value);

export function codexItemCount(game: Pick<GameState, 'discoveredItemIds' | 'itemAcquisitionCounts'>, id: string): number {
  return game.itemAcquisitionCounts[id] ?? (game.discoveredItemIds.includes(id) ? 1 : 0);
}

/** 筛选后要展示的物品。只有获得过的物品才出现；唯一的例外是「收集品」页签，
 *  没获得过的收集品也占一格（剪影），让玩家知道还有哪些没集齐。
 *  排序：收集品在前，其余按稀有度从高到低，同档按 ID。 */
export function codexItems(items: ItemDefinition[], game: Pick<GameState, 'discoveredItemIds' | 'itemAcquisitionCounts'>, filter: CodexFilter): ItemDefinition[] {
  const collectible = (item: ItemDefinition) => Boolean(item.tags?.includes('collectible'));
  const known = (item: ItemDefinition) => codexItemCount(game, item.id) > 0;
  return items.filter(item => {
    if (filter === 'collectible') return collectible(item);
    if (filter === 'all') return known(item);
    return item.rarity === filter && known(item);
  }).sort((a, b) => Number(collectible(b)) - Number(collectible(a)) || compareRarity(b.rarity, a.rarity) || a.id.localeCompare(b.id));
}
