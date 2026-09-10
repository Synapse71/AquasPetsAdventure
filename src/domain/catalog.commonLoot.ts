import type { ItemDefinition } from "./types";

// 常见（白）档战利品：生活里随处可见的基础材料、零件、工具和杂物。
//
// 重量换算约定：1 点负重 ≈ 0.2 kg。下限 0，最小粒度 0.1 点（= 20 g）。
// 初始宠物（体能 2）的负重上限是 8 + 2 × 4 = 16 点，约合 3.2 kg。
//
// 白档重量 0.1–1.2，出售价值 1–50：杂物 1–5，材料 2–30，工具 6–50。
// 多数物品可堆叠，一格能装多少见各条的 stackSize（省略即一件一格）。
// 按内容约定，传说以下不写描述。
// 全部为占位数据，可以在配置台的“物品”分类下直接改。

export const commonLoot: Record<string, ItemDefinition> = {
  // ── 基础材料 ──────────────────────────────────────────────
  "cloth-strip": { id: "cloth-strip", name: "布条", rarity: "common", weight: 0.1, stackSize: 20, sellable: true, sellValue: 5, tags: ["material"] },
  paper: { id: "paper", name: "纸张", rarity: "common", weight: 0.1, stackSize: 20, sellable: true, sellValue: 2, tags: ["material"] },
  "glass-shard": { id: "glass-shard", name: "玻璃碎片", rarity: "common", weight: 0.1, stackSize: 40, sellable: true, sellValue: 1 },
  "rubber-block": { id: "rubber-block", name: "橡胶块", rarity: "common", weight: 0.4, stackSize: 12, sellable: true, sellValue: 10, tags: ["material"] },
  "wood-strip": { id: "wood-strip", name: "木条", rarity: "common", weight: 1.2, stackSize: 8, sellable: true, sellValue: 9, tags: ["material"] },
  "hemp-rope": { id: "hemp-rope", name: "麻绳", rarity: "common", weight: 0.3, stackSize: 12, sellable: true, sellValue: 6, tags: ["material", "tool"] },
  fur: { id: "fur", name: "毛皮", rarity: "common", weight: 0.6, stackSize: 4, sellable: true, sellValue: 30, tags: ["material"] },
  "iron-sheet": { id: "iron-sheet", name: "铁片", rarity: "common", weight: 0.5, stackSize: 12, sellable: true, sellValue: 15, tags: ["material"] },

  // ── 零件 ──────────────────────────────────────────────────
  keycap: { id: "keycap", name: "键帽", rarity: "common", weight: 0.1, stackSize: 20, sellable: true, sellValue: 3 },
  bulb: { id: "bulb", name: "灯泡", rarity: "common", weight: 0.2, stackSize: 12, sellable: true, sellValue: 8, tags: ["material"] },
  spring: { id: "spring", name: "弹簧", rarity: "common", weight: 0.2, stackSize: 12, sellable: true, sellValue: 4, tags: ["material"] },
  screw: { id: "screw", name: "螺丝", rarity: "common", weight: 0.1, stackSize: 20, sellable: true, sellValue: 3, tags: ["material"] },
  nail: { id: "nail", name: "钉子", rarity: "common", weight: 0.1, stackSize: 20, sellable: true, sellValue: 2, tags: ["material"] },
  battery: { id: "battery", name: "电池", rarity: "common", weight: 0.2, stackSize: 12, sellable: true, sellValue: 15, tags: ["material"] },
  magnet: { id: "magnet", name: "磁铁", rarity: "common", weight: 0.4, stackSize: 12, sellable: true, sellValue: 9, tags: ["tool", "material"] },
  bearing: { id: "bearing", name: "轴承", rarity: "common", weight: 0.1, stackSize: 12, sellable: true, sellValue: 10, tags: ["material"] },
  gear: { id: "gear", name: "齿轮", rarity: "common", weight: 0.2, stackSize: 12, sellable: true, sellValue: 5, tags: ["material"] },
  "wire-cable": { id: "wire-cable", name: "电线", rarity: "common", weight: 0.4, stackSize: 8, sellable: true, sellValue: 7, tags: ["material"] },

  // ── 工具 ──────────────────────────────────────────────────
  scissors: { id: "scissors", name: "剪刀", rarity: "common", weight: 0.6, sellable: true, sellValue: 15, tags: ["tool"] },
  screwdriver: { id: "screwdriver", name: "螺丝刀", rarity: "common", weight: 0.5, sellable: true, sellValue: 18, tags: ["tool"] },
  "tape-measure": { id: "tape-measure", name: "卷尺", rarity: "common", weight: 0.5, sellable: true, sellValue: 21, tags: ["tool"] },
  "duct-tape": { id: "duct-tape", name: "胶带", rarity: "common", weight: 0.2, stackSize: 12, sellable: true, sellValue: 7, tags: ["tool", "material"] },
  wrench: { id: "wrench", name: "扳手", rarity: "common", weight: 0.8, sellable: true, sellValue: 24, tags: ["tool"] },
  hammer: { id: "hammer", name: "锤子", rarity: "common", weight: 0.8, sellable: true, sellValue: 50, tags: ["tool"] },

  // ── 杂物与垃圾 ────────────────────────────────────────────
  "plastic-cup": { id: "plastic-cup", name: "塑料杯子", rarity: "common", weight: 0.3, sellable: true, sellValue: 20, tags: ["tool"] },
  "soda-can": { id: "soda-can", name: "易拉罐", rarity: "common", weight: 0.2, stackSize: 20, sellable: true, sellValue: 5 },
  "empty-bottle": { id: "empty-bottle", name: "空塑料瓶", rarity: "common", weight: 0.1, stackSize: 20, sellable: true, sellValue: 2 },
  poop: { id: "poop", name: "便便", rarity: "common", weight: 0.2, stackSize: 20, sellable: true, sellValue: 1 },
  "old-newspaper": { id: "old-newspaper", name: "旧报纸", rarity: "common", weight: 0.4, stackSize: 8, sellable: true, sellValue: 3 },
  "ceramic-shard": { id: "ceramic-shard", name: "碎瓷片", rarity: "common", weight: 0.1, stackSize: 40, sellable: true, sellValue: 2 },
};
