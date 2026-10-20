import { describe, it, expect } from 'vitest';
import { codexItemCount, codexItems } from './codexGroups';
import type { ItemDefinition } from '../domain/types';
const item = (id: string, rarity: ItemDefinition['rarity'], tags: string[] = []): ItemDefinition => ({ id, name: id, rarity, tags, weight: 1, sellable: false });
describe('codex filtering', () => {
  it('uses recorded lifetime counts and falls back only for legacy entries', () => {
    const game = { discoveredItemIds:['zero','old','known'], itemAcquisitionCounts:{zero:0,known:9} };
    expect(codexItemCount(game,'zero')).toBe(0);
    expect(codexItemCount(game,'known')).toBe(9);
    expect(codexItemCount(game,'old')).toBe(1);
    expect(codexItemCount(game,'unknown')).toBe(0);
  });
  const items = [item('unknown-ordinary', 'mythic'), item('unknown-collectible', 'epic', ['collectible']), item('known-collectible', 'rare', ['collectible']), item('common', 'common'), item('rare', 'rare')];
  const game = { discoveredItemIds: ['common', 'rare', 'known-collectible'], itemAcquisitionCounts: { common: 7, rare: 1, 'known-collectible': 1 } };
  const ids = (filter: Parameters<typeof codexItems>[2]) => codexItems(items, game, filter).map(entry => entry.id);
  it('shows only acquired items under all, collectibles first', () => {
    expect(ids('all')).toEqual(['known-collectible', 'rare', 'common']);
  });
  it('lists every collectible, acquired or not, under the collectible filter', () => {
    expect(ids('collectible')).toEqual(['unknown-collectible', 'known-collectible']);
  });
  it('filters by rarity without leaking unacquired items', () => {
    expect(ids('rare')).toEqual(['known-collectible', 'rare']);
    expect(ids('epic')).toEqual([]);
    expect(ids('mythic')).toEqual([]);
  });
});
