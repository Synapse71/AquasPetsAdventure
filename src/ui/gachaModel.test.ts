import { describe, expect, it } from 'vitest';
import { bundledCatalog } from '../domain/catalog';
import { gachaClip, gachaEggStyle, gachaPrizeFill, gachaTier } from './gachaModel';
import { ITEM_CELL_COLORS } from './rarityColors';

describe('开蛋演出档位', () => {
  it('道具按物品稀有度，金币算稀有，经验算史诗', () => {
    expect(gachaTier({ kind: 'item', amount: 1, itemId: 'x', rarity: 'uncommon' })).toBe('uncommon');
    expect(gachaTier({ kind: 'currency', amount: 100 })).toBe('rare');
    expect(gachaTier({ kind: 'xp', amount: 30 })).toBe('epic');
    // 占位演出的蛋壳色也跟着档位走。
    expect(gachaEggStyle({ kind: 'currency', amount: 1 })).toEqual(gachaEggStyle({ kind: 'item', amount: 1, itemId: 'x', rarity: 'rare' }));
  });

  it('视频和末帧齐全才算这一档有正式演出', () => {
    const base = '../../assets/ui-prototype/gacha/opening-v1';
    const sources = { clips: { [`${base}/rare/open-anim.mp4`]: 'clip.mp4', [`${base}/epic/open-anim.mp4`]: 'e.mp4' }, stills: { [`${base}/rare/open-still.webp`]: 'still.webp' } };
    expect(gachaClip('rare', sources)).toEqual({ clip: 'clip.mp4', still: 'still.webp' });
    expect(gachaClip('epic', sources)).toBeNull();
    expect(gachaClip('uncommon', sources)).toBeNull();
  });
});

describe('奖品方框底色', () => {
  it('道具和仓库格子同色，金币、经验各有固定底色', () => {
    expect(gachaPrizeFill({ kind: 'item', amount: 1, itemId: 'x', rarity: 'epic' })).toBe(ITEM_CELL_COLORS.epic);
    expect(gachaPrizeFill({ kind: 'item', amount: 1, itemId: 'x' })).toBe(ITEM_CELL_COLORS.common);
    expect(gachaPrizeFill({ kind: 'currency', amount: 1 })).not.toBe(gachaPrizeFill({ kind: 'xp', amount: 1 }));
  });
});
