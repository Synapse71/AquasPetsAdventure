import type { GameState, ItemDefinition } from '../domain/types';
import { RARITIES, RARITY_LABELS } from '../domain/rarity';
export function codexItemCount(game: Pick<GameState, 'discoveredItemIds' | 'itemAcquisitionCounts'>, id: string): number {
  return game.itemAcquisitionCounts[id] ?? (game.discoveredItemIds.includes(id) ? 1 : 0);
}
export function codexGroups(items: ItemDefinition[], game: Pick<GameState, 'discoveredItemIds' | 'itemAcquisitionCounts'>) {
  const ordered = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const collectibles = ordered.filter(item => item.tags?.includes('collectible'));
  const ordinary = ordered.filter(item => !item.tags?.includes('collectible') && codexItemCount(game,item.id) > 0);
  return [
    { id: 'collectible', label: '收藏品', items: collectibles },
    ...[...RARITIES].reverse().map(rarity => ({ id: rarity, label: RARITY_LABELS[rarity], items: ordinary.filter(item => item.rarity === rarity) })),
  ].filter(group => group.items.length > 0);
}
