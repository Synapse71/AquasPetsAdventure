import type { ItemDefinition } from "./types";

// 传说（黄）档战利品。
//
// 重量沿用 catalog.commonLoot.ts 的换算：1 点负重 ≈ 0.2 kg，
// 下限 0，最小粒度 0.1 点（= 20 g）。
//
// 按内容约定，传说及以上需要写描述。
// 售价为占位值，等待统一调整。

export const legendaryLoot: Record<string, ItemDefinition> = {
  "cracked-core": {
    id: "cracked-core",
    name: "破损核心",
    description: "“变废为宝。”",
    rarity: "legendary",
    weight: 0.5,
    sellable: true,
    sellValue: 10000,
  },
  "florid-postern-statue": {
    id: "florid-postern-statue",
    name: "绚丽之门雕像",
    description: "“它的美丽略带令人心碎的悲伤。”",
    rarity: "legendary",
    weight: 5,
    sellable: true,
    sellValue: 46800,
  },
  "card-stoat": {
    id: "card-stoat",
    name: "卡牌：白鼬",
    description: "看起来平平无奇的卡片，但仿佛下一秒这张牌上面的白鼬就要开口说话。",
    rarity: "legendary",
    weight: 0.2,
    sellable: true,
    sellValue: 3350,
  },
  "icarus-mech-model": {
    id: "icarus-mech-model",
    name: "伊卡洛斯量产机模型",
    description: "「报告主脑，任务已完成」 ——编号 IC-0001",
    rarity: "legendary",
    weight: 0.5,
    sellable: true,
    sellValue: 11832,
  },
};
