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

/** 物品悬浮提示的数据。展示口径与仓库详情栏一致，只补上当前这一格的数量。 */
export function itemTooltipInfo(itemId: string, quantity = 0): ItemTooltipInfo | undefined {
  const item = catalog.items[itemId];
  if (!item) return undefined;
  const stack = item.stackSize && item.stackSize > 0 ? item.stackSize : 1;
  const facts: { label: string; value: string }[] = [];
  if (stack > 1) facts.push({ label: '堆叠', value: `每格 ${stack} 件` });
  facts.push({ label: '重量', value: quantity ? `${num(item.weight * quantity)}（单重 ${num(item.weight)}）` : num(item.weight) });
  facts.push({
    label: '售价',
    value: item.sellable
      ? `${num(item.sellValue ?? 0)} ／ 件${quantity > 1 ? `（本格 ${num((item.sellValue ?? 0) * quantity)}）` : ''}`
      : '不可出售',
  });
  const effects: string[] = [];
  if (item.tagGrantId) effects.push(`使用后永久赋予特质「${catalog.tags[item.tagGrantId]?.name ?? item.tagGrantId}」`);
  if (item.secondaryGrant) {
    effects.push(`使用后 ${SECONDARY_STAT_LABELS[item.secondaryGrant.stat]} +${item.secondaryGrant.amount}（永久生效，上限 ${secondaryStatCap()}）`);
  }
  // 食物 buff 只对整趟冒险有效，和永久生效的成长道具分开写，避免读成同一件事。
  if (item.foodBuff) effects.push(`出发前吃下：${STAT_LABELS[item.foodBuff.stat]} +${item.foodBuff.amount}，整趟冒险有效（同时只能有一个）`);
  if (item.foodHeal) effects.push(`吃下恢复 ${item.foodHeal.steps} 档伤势`);
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
