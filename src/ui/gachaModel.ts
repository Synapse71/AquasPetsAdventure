import type { Rarity } from '../domain/rarity';
import type { GachaDefinition, GachaPrize } from '../domain/types';
import { ITEM_CELL_COLORS } from './rarityColors';

export type GachaStage = 'idle' | 'turning' | 'dropping' | 'opening' | 'playing' | 'revealed';

// 占位演出的三段时长：转把手、蛋滚出来、开壳。正式美术接入后替换。
export const GACHA_STAGE_MS = { turning: 900, dropping: 600, opening: 1100 } as const;

// 蛋壳色沿用物品格的六档稀有度底色；金币、经验按 gachaTier 挂到稀有、史诗档。
const RARITY_EGG = ITEM_CELL_COLORS;

// 金币、经验没有稀有度，奖品方框用各自图标的浅色底：金币浅金、经验浅蓝。
const PRIZE_FILL = { currency: '#fbe7a6', xp: '#d6eafb' } as const;

/** 奖品方框的底色：开蛋弹出的奖品方框用它。道具跟仓库格子一样按稀有度上色。 */
export function gachaPrizeFill(prize: GachaPrize): string {
  return prize.kind === 'item' ? ITEM_CELL_COLORS[prize.rarity ?? 'common'] : PRIZE_FILL[prize.kind];
}
const RARITY_STEP: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };

/** 档位越高，开壳光晕越大、火花越多。CSS 占位演出用，还没做视频的档位才会走到。 */
export function gachaEggStyle(prize: GachaPrize): { color: string; glow: number; sparks: number } {
  const tier = gachaTier(prize);
  const step = RARITY_STEP[tier];
  return { color: RARITY_EGG[tier], glow: 0.6 + step * 0.35, sparks: 2 + step * 2 };
}

// ---- 正式开蛋视频（tools/build-gacha-opening.py 产出）----

const clips = import.meta.glob<string>('../../assets/ui-prototype/gacha/opening-v1/*/open-anim.mp4', { eager: true, query: '?url', import: 'default' });
const stills = import.meta.glob<string>('../../assets/ui-prototype/gacha/opening-v1/*/open-still.webp', { eager: true, query: '?url', import: 'default' });
const idleImages = import.meta.glob<string>('../../assets/ui-prototype/gacha/first-frame/machine-d.webp', { eager: true, query: '?url', import: 'default' });

/** 没抽之前显示的扭蛋机。所有档位的视频都从这张图起播。 */
export const GACHA_IDLE_IMAGE: string | undefined = Object.values(idleImages)[0];

/** 视频没能播（解码失败、被策略挡住）时的兜底收尾时长，略长于 5 秒原片。 */
export const GACHA_CLIP_MS = 5300;

/**
 * 奖励播哪一档的开蛋演出：道具按物品稀有度；金币算稀有，经验算史诗。
 * 金币和经验没有物品档位，按它们大致的价值感挂到中间两档上。
 */
export function gachaTier(prize: GachaPrize): Rarity {
  if (prize.kind === 'currency') return 'rare';
  if (prize.kind === 'xp') return 'epic';
  return prize.rarity ?? 'common';
}

/** 该档的开蛋视频与末帧；还没做视频的档位返回 null，继续用 CSS 占位演出。 */
export function gachaClip(tier: Rarity, sources: { clips: Record<string, string>; stills: Record<string, string> } = { clips, stills }): { clip: string; still: string } | null {
  const base = `../../assets/ui-prototype/gacha/opening-v1/${tier}`;
  const clip = sources.clips[`${base}/open-anim.mp4`];
  const still = sources.stills[`${base}/open-still.webp`];
  return clip && still ? { clip, still } : null;
}
