import type { Rarity } from '../domain/rarity';
import type { GachaPrize } from '../domain/types';

export type GachaStage = 'idle' | 'turning' | 'dropping' | 'opening' | 'revealed';

// 占位演出的三段时长：转把手、蛋滚出来、开壳。正式美术接入后替换。
export const GACHA_STAGE_MS = { turning: 900, dropping: 600, opening: 1100 } as const;

// 蛋壳色沿用物品格的六档稀有度底色；金币蛋、经验蛋各用一种固定色，避免和档位混淆。
const RARITY_EGG: Record<Rarity, string> = {
  common: '#e3e3e3',
  uncommon: '#a8dc82',
  rare: '#74b9f0',
  epic: '#b98bee',
  legendary: '#f3c63c',
  mythic: '#f08a86',
};
const RARITY_STEP: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };

/** 档位越高，开壳光晕越大、火花越多。金币与经验按蓝色档的表现。 */
export function gachaEggStyle(prize: GachaPrize): { color: string; glow: number; sparks: number } {
  if (prize.kind === 'currency') return { color: '#f7d774', glow: 1, sparks: 4 };
  if (prize.kind === 'xp') return { color: '#7fd1c7', glow: 1, sparks: 4 };
  const step = RARITY_STEP[prize.rarity ?? 'common'];
  return { color: RARITY_EGG[prize.rarity ?? 'common'], glow: 0.6 + step * 0.35, sparks: 2 + step * 2 };
}
