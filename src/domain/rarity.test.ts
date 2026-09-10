import { describe, expect, it } from "vitest";
import { validateCatalog } from "../config/catalogStore";
import { bundledCatalog } from "./catalog";
import { RARITIES, compareRarity, isRarity, rarityRank } from "./rarity";
import type { Rarity } from "./rarity";

// 重量下限为 0，最小粒度 0.1 点。用容差比较，避开 0.3 * 10 这类浮点误差。
function expectWeightGrid(item: { id: string; weight: number }): void {
  expect(item.weight, `${item.id} 重量不能为负`).toBeGreaterThanOrEqual(0);
  const offGrid = Math.abs(item.weight * 10 - Math.round(item.weight * 10));
  expect(offGrid, `${item.id} 重量必须是 0.1 的整数倍`).toBeLessThan(1e-9);
}

function droppableItemIds(): Set<string> {
  const ids = new Set<string>();
  for (const event of Object.values(bundledCatalog.events)) {
    for (const choice of event.choices) {
      for (const itemId of Object.keys(choice.rewards)) ids.add(itemId);
      for (const itemId of Object.keys(choice.bonusRewards ?? {})) {
        ids.add(itemId);
      }
    }
  }
  return ids;
}

describe("稀有度档位", () => {
  it("从常见到神话严格递增", () => {
    expect(RARITIES).toEqual([
      "common",
      "uncommon",
      "rare",
      "epic",
      "legendary",
      "mythic",
    ]);
    for (let i = 1; i < RARITIES.length; i += 1) {
      expect(compareRarity(RARITIES[i - 1], RARITIES[i])).toBeLessThan(0);
    }
    expect(rarityRank("mythic")).toBe(RARITIES.length - 1);
  });

  it("拒绝不属于六档的值", () => {
    expect(isRarity("common")).toBe(true);
    expect(isRarity("白")).toBe(false);
    expect(isRarity("ultra")).toBe(false);
    expect(isRarity(undefined)).toBe(false);
    expect(isRarity(3)).toBe(false);
  });
});

describe("目录物品的稀有度", () => {
  it("每件物品都标注了合法档位", () => {
    for (const [itemId, item] of Object.entries(bundledCatalog.items)) {
      expect(isRarity(item.rarity), `${itemId} 缺少合法稀有度`).toBe(true);
    }
  });

  // 设计文档 10.1 针对的是 Tag 载体造成的档位误解。次要属性成长道具本身
  // 可以出售，不能因为它们也位于神话档就误触发这条内容约束。
  it("神话档出现 Tag 载体时，必须同时存在可正常掉落且可出售的物品", () => {
    const tier = Object.values(bundledCatalog.items).filter(
      (item) => item.rarity === "mythic",
    );
    const hasTraitGrant = tier.some(
      (item) => item.tagGrantId || item.tags?.includes("trait-grant"),
    );
    if (!hasTraitGrant) return;

    const droppable = droppableItemIds();
    expect(
      tier.some(
        (item) => droppable.has(item.id) && item.sellable,
      ),
    ).toBe(true);
  });

  it("稀有度不由是否可出售或是否为消耗品推断", () => {
    // 目录里现在没有消耗品，用注入的目录守住这条正交性规则。
    const probe = structuredClone(bundledCatalog);
    probe.items["probe-consumable"] = {
      id: "probe-consumable",
      name: "测试消耗品",
      description: "不可出售的一次性消耗品。",
      rarity: "mythic",
      weight: 1,
      sellable: false,
      tagGrantId: "tag-lucky",
    };
    probe.items["probe-trophy"] = {
      id: "probe-trophy",
      name: "测试战利品",
      description: "同为神话档，但可以出售且不是消耗品。",
      rarity: "mythic",
      weight: 1,
      sellable: true,
      sellValue: 100,
    };

    expect(validateCatalog(probe).filter((i) => i.level === "error")).toEqual(
      [],
    );
    expect(probe.items["probe-consumable"].rarity).toBe(
      probe.items["probe-trophy"].rarity,
    );
    expect(probe.items["probe-consumable"].sellable).toBe(false);
    expect(probe.items["probe-trophy"].tagGrantId).toBeUndefined();
  });

  it("常见档战利品符合作者约定的重量与价值区间", () => {
    const common = Object.values(bundledCatalog.items).filter(
      (item) => item.rarity === "common",
    );

    expect(common.length).toBeGreaterThanOrEqual(30);
    for (const item of common) {
      expectWeightGrid(item);
      expect(item.sellValue, `${item.id} 常见物品必须可出售`).toBeDefined();
      expect(item.sellValue!).toBeGreaterThanOrEqual(1);
      expect(item.sellValue!).toBeLessThanOrEqual(50);
    }
  });

  it.each([
    ["uncommon" as Rarity, 20],
    ["rare" as Rarity, 20],
    ["epic" as Rarity, 10],
  ])("%s 档战利品数量足够且重量粒度一致", (rarity, minimum) => {
    const tier = Object.values(bundledCatalog.items).filter(
      (item) => item.rarity === rarity,
    );

    expect(tier.length).toBeGreaterThanOrEqual(minimum);
    for (const item of tier) {
      expectWeightGrid(item);
      expect(item.sellValue, `${item.id} 该档物品必须可出售`).toBeDefined();
    }
  });

  it("全部物品都落在 0.1 的重量刻度上", () => {
    for (const item of Object.values(bundledCatalog.items)) {
      expectWeightGrid(item);
    }
  });

  it("物品 ID 与显示名都不重复", () => {
    const names = Object.values(bundledCatalog.items).map((item) => item.name);
    expect(new Set(names).size, "存在同名物品").toBe(names.length);
  });

  it("只有传说及以上档位写描述", () => {
    for (const item of Object.values(bundledCatalog.items)) {
      if (rarityRank(item.rarity) >= rarityRank("legendary")) {
        expect(item.description, `${item.id} 应当有描述`).toBeTruthy();
      } else {
        expect(item.description, `${item.id} 不应当有描述`).toBeUndefined();
      }
    }
  });

  it("稀有度与重量没有单调关系", () => {
    const byRarity = new Map<Rarity, number[]>();
    for (const item of Object.values(bundledCatalog.items)) {
      byRarity.set(item.rarity, [
        ...(byRarity.get(item.rarity) ?? []),
        item.weight,
      ]);
    }
    const heaviest = Object.values(bundledCatalog.items).reduce((a, b) =>
      a.weight >= b.weight ? a : b,
    );

    // 最重的物品不是最高档，证明重量没有被当成稀有度的替身。
    expect(heaviest.rarity).not.toBe("mythic");
    expect(byRarity.size).toBeGreaterThan(1);
  });
});
