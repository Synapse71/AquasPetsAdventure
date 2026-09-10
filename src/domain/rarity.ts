// 稀有度表达获取难度，与重量无关，也不参与任何随机计算。
// 掉落概率由节点事件池和事件权重决定，物品不携带掉落率。
// 详见 docs/game-system-design.md 第 10.1 节。

export const RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
] as const;

export type Rarity = (typeof RARITIES)[number];

export const RARITY_LABELS: Record<Rarity, string> = {
  common: "常见",
  uncommon: "罕见",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};

export const RARITY_COLOR_NAMES: Record<Rarity, string> = {
  common: "白",
  uncommon: "绿",
  rare: "蓝",
  epic: "紫",
  legendary: "黄",
  mythic: "红",
};

export function isRarity(value: unknown): value is Rarity {
  return (
    typeof value === "string" && (RARITIES as readonly string[]).includes(value)
  );
}

// 稀有度只有顺序意义。rank 仅用于档位比较和排序，不得参与数值运算。
export function rarityRank(rarity: Rarity): number {
  return RARITIES.indexOf(rarity);
}

export function compareRarity(a: Rarity, b: Rarity): number {
  return rarityRank(a) - rarityRank(b);
}
