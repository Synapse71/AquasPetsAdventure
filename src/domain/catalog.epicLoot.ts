import type { ItemDefinition } from "./types";

// 史诗（紫）档战利品：生活中真正意义上的贵重物品。
// 相对稀有档的判据是"这一件出手就抵得上前面一整包"：
// 贵金属与宝石首饰、高性能整机、专业器材、收藏级乐器与年份酒。
//
// 重量沿用 catalog.commonLoot.ts 的换算：1 点负重 ≈ 0.2 kg，
// 下限 0，最小粒度 0.1 点（= 20 g）。
//
// 本档刻意做出两端分化：钻石耳钉、黄金项链几乎不占负重（必拿），
// 黑胶唱机 20 点、天文望远镜 25 点超过初始宠物 16 点的上限（必须组队或放弃），
// 让"带走哪一件"成为真正的取舍而不是排序。
//
// 售价为占位值，等待统一调整。按内容约定，传说以下不写描述。

export const epicLoot: Record<string, ItemDefinition> = {
  // ── 贵金属与宝石首饰 ──────────────────────────────────────
  "diamond-earrings": { id: "diamond-earrings", name: "钻石耳钉", rarity: "epic", weight: 0.2, sellable: true, sellValue: 1040 },
  "gold-necklace": { id: "gold-necklace", name: "黄金项链", rarity: "epic", weight: 0.4, sellable: true, sellValue: 3958 },

  // ── 收藏级器物 ────────────────────────────────────────────
  violin: { id: "violin", name: "小提琴", rarity: "epic", weight: 2.5, sellable: true, sellValue: 10086 },
  "leather-handbag": { id: "leather-handbag", name: "真皮手袋", rarity: "epic", weight: 1.4, sellable: true, sellValue: 8163 },
  "aged-whisky": { id: "aged-whisky", name: "陈年威士忌", rarity: "epic", weight: 1.6, sellable: true, sellValue: 3932, tags: ["food"] },

  // ── 高性能整机与专业器材 ──────────────────────────────────
  "graphics-card": { id: "graphics-card", name: "游戏显卡", rarity: "epic", weight: 1.6, sellable: true, sellValue: 7799 },
  "telephoto-lens": { id: "telephoto-lens", name: "单反长焦镜头", rarity: "epic", weight: 1.5, sellable: true, sellValue: 4009 },
  laptop: { id: "laptop", name: "笔记本电脑", rarity: "epic", weight: 2.2, sellable: true, sellValue: 9797 },
  turntable: { id: "turntable", name: "黑胶唱机", rarity: "epic", weight: 2.7, sellable: true, sellValue: 9980 },
  telescope: { id: "telescope", name: "天文望远镜", rarity: "epic", weight: 4, sellable: true, sellValue: 11313 },
};
