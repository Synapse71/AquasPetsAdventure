import { catalog } from '../domain/catalog';
import { INJURY_LABELS, STAT_LABELS } from '../domain/engine';
import type { Expedition, GameState, InjuryStage, Pet, StatKey } from '../domain/types';

const INJURY_ORDER: InjuryStage[] = ['healthy', 'injured', 'incapacitated'];

/** 这件东西能不能吃。配了任一效果就能吃——两个字段互相独立（设计文档 9.3）。 */
export const foodInCargo = (itemId: string) => {
  const item = catalog.items[itemId];
  return Boolean(item?.foodBuff || item?.foodHeal);
};

/** 队伍里伤得最重的一只；和引擎 mostInjuredPet 用同一条并列规则（取 petIds 靠前的）。 */
function mostInjured(game: GameState, petIds: string[]): Pet | undefined {
  return petIds.map(id => game.pets[id]).filter((p): p is Pet => !!p && p.injury !== 'healthy')
    .sort((a, b) => INJURY_ORDER.indexOf(b.injury) - INJURY_ORDER.indexOf(a.injury))[0];
}

/**
 * 「吃掉」按钮上的后果预告。要说清三件事：加什么、顶掉什么、治谁。
 * 顶掉那句尤其重要——同时只存在一个 buff，不写出来玩家会误吃掉更好的那个。
 */
export function foodEatLabel(game: GameState, expedition: Expedition, itemId: string): string {
  const item = catalog.items[itemId];
  const parts: string[] = [];
  if (item?.foodBuff) {
    parts.push(`${STAT_LABELS[item.foodBuff.stat]} +${item.foodBuff.amount}`);
    const current = expedition.foodBuff;
    if (current) parts.push(`顶掉现有的 ${STAT_LABELS[current.stat]} +${current.amount}`);
  }
  if (item?.foodHeal) {
    const target = mostInjured(game, expedition.petIds);
    if (target) {
      const next = INJURY_ORDER[Math.max(0, INJURY_ORDER.indexOf(target.injury) - Math.max(1, item.foodHeal.steps))];
      parts.push(`${target.name} ${INJURY_LABELS[target.injury]}→${INJURY_LABELS[next]}`);
    } else if (!item.foodBuff) {
      parts.push('队里没人需要治疗');
    }
  }
  return parts.join(' · ');
}

/**
 * 风险说明里「队伍主属性」那一项要不要注明食物的贡献。
 * 只有 buff 正好加在这次检定的属性上才提——加体能的食物不该出现在感知检定的说明里，
 * 那会让玩家以为风险少了 1 点却对不上账。
 */
export function foodBuffNote(expedition: Expedition, stat: StatKey): string {
  const buff = expedition.foodBuff;
  return buff && buff.stat === stat ? `（含食物 +${buff.amount}）` : '';
}
