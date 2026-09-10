import { describe, it, expect } from 'vitest';
import { codexGroups, codexItemCount } from './codexGroups';
import type { ItemDefinition } from '../domain/types';
const item = (id: string, rarity: ItemDefinition['rarity'], tags: string[] = []): ItemDefinition => ({ id, name: id, rarity, tags, weight: 1, sellable: false });
describe('codex grouping', () => {
  it('uses recorded lifetime counts and falls back only for legacy entries', () => {
    const game = { discoveredItemIds:['zero','old','known'], itemAcquisitionCounts:{zero:0,known:9} };
    expect(codexItemCount(game,'zero')).toBe(0);
    expect(codexItemCount(game,'known')).toBe(9);
    expect(codexItemCount(game,'old')).toBe(1);
    expect(codexItemCount(game,'unknown')).toBe(0);
  });
  it('keeps unknown collectibles in one top group and hides unknown ordinary items', () => {
    const groups = codexGroups([item('unknown-ordinary', 'mythic'), item('unknown-collectible', 'epic', ['collectible']), item('common', 'common'), item('rare', 'rare')], { discoveredItemIds: ['common', 'rare'], itemAcquisitionCounts: { common: 7, rare: 1 } });
    expect(groups.map(group => group.id)).toEqual(['collectible', 'rare', 'common']);
    expect(groups.flatMap(group => group.items.map(item => item.id))).toEqual(['unknown-collectible', 'rare', 'common']);
  });
});
