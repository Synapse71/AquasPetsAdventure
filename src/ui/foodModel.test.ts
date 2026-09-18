import { afterEach, describe, expect, it } from 'vitest';
import { bundledCatalog, catalog, setCatalog } from '../domain/catalog';
import { createInitialState } from '../domain/engine';
import type { Expedition, GameState } from '../domain/types';
import { foodBuffNote, foodEatLabel, foodInCargo } from './foodModel';

/** 先清空再声明，别在配表上叠加——否则策划改一次数值，测试的含义就变了。 */
function withFood() {
  const next = structuredClone(bundledCatalog);
  for (const item of Object.values(next.items)) { delete item.foodBuff; delete item.foodHeal; }
  next.items.chocolate.foodBuff = { stat: 'fitness', amount: 2 };   // 纯 buff
  next.items['coffee-beans'].foodBuff = { stat: 'perception', amount: 3 };
  next.items['canned-food'].foodHeal = { steps: 1 };                // 纯治疗
  setCatalog(next);
  return next;
}
afterEach(() => setCatalog(bundledCatalog));

function team(injuries: Record<string, 'healthy' | 'injured' | 'incapacitated'>): { game: GameState; expedition: Expedition } {
  const base = createInitialState();
  const pets = Object.fromEntries(Object.entries(injuries).map(([id, injury], i) => [
    id, { ...structuredClone(base.pets.gugugaga), id, name: `宠物${i + 1}`, injury },
  ]));
  return {
    game: { ...base, pets },
    expedition: { petIds: Object.keys(pets), cargo: {} } as Expedition,
  };
}

describe('能不能吃', () => {
  it('配了任一效果就能吃，两个字段互相独立', () => {
    withFood();
    expect(foodInCargo('chocolate')).toBe(true);
    expect(foodInCargo('canned-food')).toBe(true);
    expect(foodInCargo('paper')).toBe(false);
    expect(foodInCargo('不存在的物品')).toBe(false);
  });

  it('没配效果就吃不了——哪些能吃完全由配表决定', () => {
    const bare = structuredClone(bundledCatalog);
    for (const item of Object.values(bare.items)) { delete item.foodBuff; delete item.foodHeal; }
    setCatalog(bare);
    expect(catalog.items.chocolate.tags).toContain('food');  // 还是食物
    expect(foodInCargo('chocolate')).toBe(false);            // 但没配效果就吃不了
  });
});

describe('吃掉按钮的后果预告', () => {
  it('写清楚会顶掉哪个 buff——单槽替换全靠这句话防误操作', () => {
    withFood();
    const { game, expedition } = team({ a: 'healthy' });
    expect(foodEatLabel(game, expedition, 'chocolate')).toBe('体能 +2');
    const busy = { ...expedition, foodBuff: { itemId: 'coffee-beans', stat: 'perception' as const, amount: 3 } };
    expect(foodEatLabel(game, busy, 'chocolate')).toBe('体能 +2 · 顶掉现有的 感知 +3');
  });

  it('治疗预告点名到具体宠物和档位变化', () => {
    withFood();
    const { game, expedition } = team({ a: 'healthy', b: 'injured' });
    expect(foodEatLabel(game, expedition, 'canned-food')).toBe('宠物2 受伤→正常');
  });

  it('并列时取队伍里靠前的那只，和引擎同一条规则', () => {
    withFood();
    const { game, expedition } = team({ a: 'injured', b: 'injured' });
    expect(foodEatLabel(game, expedition, 'canned-food')).toContain('宠物1');
  });

  it('伤得最重的优先，不是排最前的', () => {
    withFood();
    const { game, expedition } = team({ a: 'injured', b: 'incapacitated' });
    expect(foodEatLabel(game, expedition, 'canned-food')).toBe('宠物2 失能→受伤');
  });

  it('纯治疗食物在无人受伤时明说吃了没用', () => {
    withFood();
    const { game, expedition } = team({ a: 'healthy' });
    expect(foodEatLabel(game, expedition, 'canned-food')).toBe('队里没人需要治疗');
  });
});

describe('风险说明里的食物注记', () => {
  const withBuff = (stat: 'fitness' | 'perception' | 'technique', amount: number) =>
    ({ petIds: ['a'], cargo: {}, foodBuff: { itemId: 'x', stat, amount } }) as unknown as Expedition;

  it('只在 buff 正好加这次检定的属性时才提', () => {
    expect(foodBuffNote(withBuff('fitness', 2), 'fitness')).toBe('（含食物 +2）');
    // 加体能的食物不该出现在感知检定的说明里，否则玩家会以为风险少了 2 点却对不上账
    expect(foodBuffNote(withBuff('fitness', 2), 'perception')).toBe('');
  });

  it('没有 buff 时什么都不加', () => {
    expect(foodBuffNote({ petIds: ['a'], cargo: {} } as unknown as Expedition, 'fitness')).toBe('');
  });
});
