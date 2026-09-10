import type { ItemDefinition } from "./types";

// 罕见（绿）档战利品：超市和商店里买得到、有一定价值的成品。
// 涵盖食品、生活用品、玩具和运动器材。
//
// 重量沿用 catalog.commonLoot.ts 的换算：1 点负重 ≈ 0.2 kg，
// 下限 0，最小粒度 0.1 点（= 20 g）。
// 初始宠物负重上限 16 点，所以本档里的大件（铸铁锅、哑铃、滑板、汽车轮胎）
// 单件就能吃掉大半个背包，汽车轮胎更是单宠搬不动，需要组队。
//
// 售价为占位值，等待统一调整。按内容约定，传说以下不写描述。

export const uncommonLoot: Record<string, ItemDefinition> = {
  // ── 食品 ──────────────────────────────────────────────────
  chocolate: { id: "chocolate", name: "巧克力", rarity: "uncommon", weight: 0.3, stackSize: 4, sellable: true, sellValue: 12, tags: ["food"] },
  "canned-food": { id: "canned-food", name: "罐头", rarity: "uncommon", weight: 0.5, stackSize: 4, sellable: true, sellValue: 29, tags: ["food"] },
  "coffee-beans": { id: "coffee-beans", name: "咖啡豆", rarity: "uncommon", weight: 0.2, stackSize: 4, sellable: true, sellValue: 13, tags: ["material", "food"] },
  honey: { id: "honey", name: "蜂蜜", rarity: "uncommon", weight: 0.7, stackSize: 4, sellable: true, sellValue: 36, tags: ["food"] },
  "red-wine": { id: "red-wine", name: "红酒", rarity: "uncommon", weight: 1.2, stackSize: 4, sellable: true, sellValue: 150, tags: ["food"] },

  // ── 生活用品 ──────────────────────────────────────────────
  thermos: { id: "thermos", name: "保温杯", rarity: "uncommon", weight: 1, sellable: true, sellValue: 79 },
  "electric-razor": { id: "electric-razor", name: "电动剃须刀", rarity: "uncommon", weight: 1, sellable: true, sellValue: 121 },
  umbrella: { id: "umbrella", name: "雨伞", rarity: "uncommon", weight: 1.3, sellable: true, sellValue: 79, tags: ["tool"] },
  "hair-dryer": { id: "hair-dryer", name: "电吹风", rarity: "uncommon", weight: 1, sellable: true, sellValue: 83 },
  "desk-lamp": { id: "desk-lamp", name: "台灯", rarity: "uncommon", weight: 1, sellable: true, sellValue: 50 },
  "cast-iron-pan": { id: "cast-iron-pan", name: "铸铁锅", rarity: "uncommon", weight: 4, sellable: true, sellValue: 85, tags: ["tool"] },

  // ── 玩具 ──────────────────────────────────────────────────
  "f1-model": { id: "f1-model", name: "F1 赛车模型", rarity: "uncommon", weight: 0.8, sellable: true, sellValue: 57 },
  "plush-toy": { id: "plush-toy", name: "毛绒玩偶", rarity: "uncommon", weight: 1, sellable: true, sellValue: 61 },
  "jigsaw-puzzle": { id: "jigsaw-puzzle", name: "拼图", rarity: "uncommon", weight: 0.7, sellable: true, sellValue: 139 },
  "toy-drone": { id: "toy-drone", name: "无人机玩具", rarity: "uncommon", weight: 1.6, sellable: true, sellValue: 267 },

  // ── 运动与户外 ────────────────────────────────────────────
  "fishing-rod": { id: "fishing-rod", name: "专业钓竿", rarity: "uncommon", weight: 1.5, sellable: true, sellValue: 215, tags: ["tool"] },
  "rugby-ball": { id: "rugby-ball", name: "橄榄球", rarity: "uncommon", weight: 1.4, sellable: true, sellValue: 213 },
  skateboard: { id: "skateboard", name: "滑板", rarity: "uncommon", weight: 2, sellable: true, sellValue: 356 },
  dumbbell: { id: "dumbbell", name: "哑铃", rarity: "uncommon", weight: 5, sellable: true, sellValue: 56 },
  "car-tire": { id: "car-tire", name: "汽车轮胎", rarity: "uncommon", weight: 9, sellable: true, sellValue: 185, tags: ["material"] },
};
