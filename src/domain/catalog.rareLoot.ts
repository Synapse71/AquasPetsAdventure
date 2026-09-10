import type { ItemDefinition } from "./types";

// 稀有（蓝）档战利品：商店里买得到、单价明显更高的成品。
// 涵盖数码产品、高价食材，以及做工精美但材料本身不贵重的首饰器物
// （银、钛、珐琅、景泰蓝，不使用黄金或宝石）。
//
// 重量沿用 catalog.commonLoot.ts 的换算：1 点负重 ≈ 0.2 kg，
// 下限 0，最小粒度 0.1 点（= 20 g）。
// 本档多为小而贵的东西，戒指、胸针这类只有 0.1–0.2 点，
// 带走几乎不占负重，单位重量价值天然高于前两档。
//
// 售价为占位值，等待统一调整。按内容约定，传说以下不写描述。

export const rareLoot: Record<string, ItemDefinition> = {
  // ── 数码产品 ──────────────────────────────────────────────
  smartwatch: { id: "smartwatch", name: "智能手表", rarity: "rare", weight: 0.7, sellable: true, sellValue: 396 },
  "noise-cancelling-headphones": { id: "noise-cancelling-headphones", name: "降噪耳机", rarity: "rare", weight: 1.1, sellable: true, sellValue: 415 },
  "game-controller": { id: "game-controller", name: "游戏手柄", rarity: "rare", weight: 1, sellable: true, sellValue: 360 },
  "digital-camera": { id: "digital-camera", name: "数码相机", rarity: "rare", weight: 1.3, sellable: true, sellValue: 571, tags: ["tool"] },
  tablet: { id: "tablet", name: "平板电脑", rarity: "rare", weight: 1.8, sellable: true, sellValue: 891 },
  "portable-speaker": { id: "portable-speaker", name: "便携音箱", rarity: "rare", weight: 1.5, sellable: true, sellValue: 519 },
  "camera-drone": { id: "camera-drone", name: "航拍无人机", rarity: "rare", weight: 2.5, sellable: true, sellValue: 1967 },
  "mechanical-keyboard": { id: "mechanical-keyboard", name: "机械键盘", rarity: "rare", weight: 1.7, sellable: true, sellValue: 666 },

  // ── 高价食材 ──────────────────────────────────────────────
  "black-truffle": { id: "black-truffle", name: "黑松露", rarity: "rare", weight: 0.2, stackSize: 8, sellable: true, sellValue: 118, tags: ["food"] },
  caviar: { id: "caviar", name: "鱼子酱", rarity: "rare", weight: 0.3, stackSize: 8, sellable: true, sellValue: 155, tags: ["food"] },
  "red-velvet-cake": { id: "red-velvet-cake", name: "红色丝绒蛋糕", rarity: "rare", weight: 0.7, stackSize: 4, sellable: true, sellValue: 198, tags: ["food"] },
  whisky: { id: "whisky", name: "威士忌", rarity: "rare", weight: 1.5, stackSize: 4, sellable: true, sellValue: 630, tags: ["food"] },
  "bluefin-tuna": { id: "bluefin-tuna", name: "蓝鳍金枪鱼块", rarity: "rare", weight: 0.6, stackSize: 4, sellable: true, sellValue: 399, tags: ["food"] },

  // ── 首饰与工艺品 ──────────────────────────────────────────
  "titanium-ring": { id: "titanium-ring", name: "钛合金戒指", rarity: "rare", weight: 0.2, sellable: true, sellValue: 178 },
  "enamel-brooch": { id: "enamel-brooch", name: "珐琅胸针", rarity: "rare", weight: 0.2, sellable: true, sellValue: 150 },
  "silver-bracelet": { id: "silver-bracelet", name: "银手镯", rarity: "rare", weight: 0.4, sellable: true, sellValue: 198 },
  "cloisonne-ornament": { id: "cloisonne-ornament", name: "景泰蓝花瓶", rarity: "rare", weight: 1.5, sellable: true, sellValue: 669 },

  // ── 精品器物 ──────────────────────────────────────────────
  "fountain-pen": { id: "fountain-pen", name: "精品钢笔", rarity: "rare", weight: 0.5, sellable: true, sellValue: 332, tags: ["tool"] },
  "mechanical-watch": { id: "mechanical-watch", name: "机械腕表", rarity: "rare", weight: 0.5, sellable: true, sellValue: 412 },
  binoculars: { id: "binoculars", name: "望远镜", rarity: "rare", weight: 1.5, sellable: true, sellValue: 593, tags: ["tool"] },
};
