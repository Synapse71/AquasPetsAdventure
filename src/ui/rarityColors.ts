import type { Rarity } from '../domain/rarity';

/**
 * 物品格的六档稀有度底色（定稿见 assets/loot/RARITY-PALETTE.md）。
 * 仓库、背包、图鉴的格子，探险拾取卡片和抽奖开出的道具都用这一份，改色只改这里。
 */
export const ITEM_CELL_COLORS: Record<Rarity, string> = {
  common: '#e3e3e3',
  uncommon: '#a8dc82',
  rare: '#74b9f0',
  epic: '#b98bee',
  legendary: '#f3c63c',
  mythic: '#f08a86',
};
