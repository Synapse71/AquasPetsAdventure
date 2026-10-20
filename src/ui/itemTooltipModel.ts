import { catalog } from '../domain/catalog';
import { SECONDARY_STAT_LABELS, STAT_LABELS, secondaryStatCap } from '../domain/engine';
import { itemTagLabel } from '../domain/itemTags';
import { RARITY_LABELS, type Rarity } from '../domain/rarity';

const num = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 });

export interface ItemTooltipInfo {
  name: string;
  rarity: Rarity;
  rarityLabel: string;
  tags: string[];
  description: string;
  facts: { label: string; value: string }[];
  effects: string[];
}

/** 物品悬浮提示的数据。重量、售价只给当前这一格的总计，不给单件；不传数量时按 1 件算。 */
export function itemTooltipInfo(itemId: string, quantity = 1): ItemTooltipInfo | undefined {
  const item = catalog.items[itemId];
  if (!item) return undefined;
  const stack = item.stackSize && item.stackSize > 0 ? item.stackSize : 1;
  const facts: { label: string; value: string }[] = [];
  const count = Math.max(1, quantity);
  if (stack > 1) facts.push({ label: '最大堆叠', value: `${stack}` });
  facts.push({ label: '重量', value: num(item.weight * count) });
  facts.push({ label: '售价', value: item.sellable ? num((item.sellValue ?? 0) * count) : '不可出售' });
  const effects: string[] = [];
  if (item.tagGrantId) effects.push(`使用后永久赋予特质「${catalog.tags[item.tagGrantId]?.name ?? item.tagGrantId}」`);
  if (item.secondaryGrant) {
    effects.push(`使用后${SECONDARY_STAT_LABELS[item.secondaryGrant.stat]} +${item.secondaryGrant.amount}（永久生效，上限 ${secondaryStatCap()}）`);
  }
  // 食物 buff 只对接下来那一趟探险有效，和永久生效的成长道具分开写，避免读成同一件事。
  if (item.foodBuff) effects.push(`使用后${STAT_LABELS[item.foodBuff.stat]} +${item.foodBuff.amount}，只对接下来那一趟探险有效`);
  if (item.foodHeal) effects.push(`使用后恢复 ${item.foodHeal.steps} 档伤势`);
  return {
    name: item.name,
    rarity: item.rarity,
    rarityLabel: RARITY_LABELS[item.rarity],
    tags: (item.tags ?? []).map(itemTagLabel),
    description: item.description ?? '',
    facts,
    effects,
  };
}
