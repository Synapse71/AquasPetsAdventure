import { describe, expect, it } from "vitest";
import { validateCatalog } from "../config/catalogStore";
import { bundledCatalog } from "./catalog";
import { createInitialState, GameRuleError, inventorySlots } from "./engine";
import {
  claimGachaPending,
  drawGacha,
  estimateMapIncome,
  expectedGachaPrize,
  gachaDayKey,
  gachaStatus,
  paidDrawPrice,
  rollGachaPrize,
} from "./gacha";
import type { Catalog, GachaDefinition, GameState } from "./types";

const PET = "gugugaga";
// 本地时间 2026-10-12 12:00，离凌晨 4 点的重置很远。
const NOON = new Date(2026, 9, 12, 12, 0).getTime();

/**
 * 夹具写死一份抽奖配置，不读内置目录里的数值：策划在后台改了配置，测试意思不变。
 * 道具池只放两件物品，方便断言。
 */
function fixture(patch: Partial<GachaDefinition> = {}): Catalog {
  const catalog = structuredClone(bundledCatalog);
  catalog.gachas = {
    daily: {
      id: "daily",
      name: "测试扭蛋",
      resetHour: 4,
      dailyFreeDraws: 1,
      paidPrice: { base: 50, growth: 2 },
      prizeWeights: { currency: 1, xp: 1, item: 1 },
      currency: { multiplier: 1, spread: 0.2 },
      xp: { multiplier: 3, spread: 0.2 },
      itemRarityWeights: { rare: 1 },
      itemPool: [{ itemId: "chocolate", weight: 1 }],
      budgetAnchorMinutes: 30,
      budgets: { "map-1": { currency: 100, xp: 10 }, "map-2": { currency: 400, xp: 12 } },
      ...patch,
    },
  };
  catalog.items.chocolate.rarity = "rare";
  return catalog;
}

function game(currency = 0): GameState {
  return { ...createInitialState(), currency };
}

describe("每日扭蛋", () => {
  it("按重置整点切分抽奖日", () => {
    expect(gachaDayKey(new Date(2026, 9, 12, 3, 59).getTime(), 4)).toBe("2026-10-11");
    expect(gachaDayKey(new Date(2026, 9, 12, 4, 0).getTime(), 4)).toBe("2026-10-12");
  });

  it("每天先免费，之后从固定初始价按倍率涨价", () => {
    const catalog = fixture();
    let state = game(10_000);
    expect(gachaStatus(state, NOON, catalog)).toMatchObject({ freeLeft: 1, nextPrice: 0 });
    state = drawGacha(state, NOON, catalog);
    expect(state.gacha.freeUsed).toBe(1);
    expect(gachaStatus(state, NOON, catalog)?.nextPrice).toBe(50);

    const before = state.currency;
    state = { ...state, gacha: { ...state.gacha, lastPrize: undefined } };
    const afterPaid = drawGacha(state, NOON, catalog);
    const gained = afterPaid.gacha.lastPrize?.kind === "currency" ? afterPaid.gacha.lastPrize.amount : 0;
    expect(afterPaid.currency).toBe(before - 50 + gained);
    expect(gachaStatus(afterPaid, NOON, catalog)?.nextPrice).toBe(100);

    // 价格是固定金币数，解锁新地图不影响。
    const promoted = { ...afterPaid, unlockedMapIds: ["map-1", "map-2"] };
    expect(gachaStatus(promoted, NOON, catalog)?.nextPrice).toBe(100);
  });

  it("金币不够时不能付费抽，也不扣任何东西", () => {
    const catalog = fixture();
    const state = drawGacha(game(0), NOON, catalog);
    const broke = { ...state, currency: 10 };
    expect(gachaStatus(broke, NOON, catalog)?.canDraw).toBe(false);
    expect(() => drawGacha(broke, NOON, catalog)).toThrow(GameRuleError);
  });

  it("跨过重置时间后免费次数和价格都回到初始，错过的天数不累积", () => {
    const catalog = fixture();
    let state = drawGacha(game(10_000), NOON, catalog);
    state = drawGacha(state, NOON, catalog);
    const threeDaysLater = NOON + 3 * 24 * 60 * 60 * 1_000;
    expect(gachaStatus(state, threeDaysLater, catalog)).toMatchObject({ freeLeft: 1, paidCount: 0, nextPrice: 0 });
  });

  it("同一个存档重复抽得到同样结果，抽完种子前进", () => {
    const catalog = fixture();
    const state = game();
    const first = drawGacha(state, NOON, catalog);
    expect(drawGacha(state, NOON, catalog).gacha.lastPrize).toEqual(first.gacha.lastPrize);
    expect(first.gacha.seed).not.toBe(state.gacha.seed);
  });

  it("经验发给咕嘎，道具进仓库并计入图鉴", () => {
    const xpOnly = fixture({ prizeWeights: { currency: 0, xp: 1, item: 0 } });
    const leveled = drawGacha(game(), NOON, xpOnly);
    const xp = leveled.gacha.lastPrize!.amount;
    expect(xp).toBeGreaterThanOrEqual(24);
    expect(xp).toBeLessThanOrEqual(36);
    const pet = leveled.pets[PET];
    expect(pet.level > 1 || pet.xp === xp).toBe(true);

    const itemOnly = fixture({ prizeWeights: { currency: 0, xp: 0, item: 1 } });
    const looted = drawGacha(game(), NOON, itemOnly);
    expect(looted.gacha.lastPrize).toMatchObject({ kind: "item", itemId: "chocolate", rarity: "rare" });
    expect(looted.inventory.chocolate).toBe(1);
    expect(looted.itemAcquisitionCounts.chocolate).toBe(1);
  });

  it("仓库满时道具进待领取，腾出空位后再领", () => {
    const catalog = fixture({ prizeWeights: { currency: 0, xp: 0, item: 1 } });
    const full = { ...game(), warehouseSlots: 1, inventory: { "red-wine": 1 } };
    expect(inventorySlots(full.inventory, catalog)).toBe(1);
    const drawn = drawGacha(full, NOON, catalog);
    expect(drawn.inventory.chocolate).toBeUndefined();
    expect(drawn.gacha.pending).toEqual({ chocolate: 1 });
    expect(() => claimGachaPending(drawn, NOON, catalog)).toThrow(GameRuleError);

    const roomy = { ...drawn, warehouseSlots: 2 };
    const claimed = claimGachaPending(roomy, NOON, catalog);
    expect(claimed.inventory.chocolate).toBe(1);
    expect(claimed.gacha.pending).toEqual({});
    expect(claimed.itemAcquisitionCounts.chocolate).toBe(1);
  });

  it("预算为 0 的类别不参与抽取，不会开出空蛋", () => {
    const catalog = fixture({ prizeWeights: { currency: 1, xp: 1, item: 0 }, budgets: { "map-1": { currency: 0, xp: 10 } } });
    let seed = 7;
    for (let index = 0; index < 200; index += 1) {
      const roll = rollGachaPrize(catalog.gachas.daily, { currency: 0, xp: 10 }, seed, catalog);
      expect(roll.prize.kind).toBe("xp");
      seed = roll.seed;
    }
  });

  it("大量抽取的平均值贴近配置期望", () => {
    const catalog = fixture({ itemRarityWeights: { uncommon: 600, rare: 370, epic: 25, legendary: 4 }, itemPool: bundledCatalog.gachas.daily.itemPool });
    const definition = catalog.gachas.daily;
    const budget = { currency: 400, xp: 12 };
    const expected = expectedGachaPrize(definition, budget, catalog);
    const totals = { currency: [0, 0], xp: [0, 0], item: [0, 0] };
    let seed = 12345;
    for (let index = 0; index < 60_000; index += 1) {
      const roll = rollGachaPrize(definition, budget, seed, catalog);
      seed = roll.seed;
      const { prize } = roll;
      const value = prize.kind === "item" ? catalog.items[prize.itemId!].sellValue ?? 0 : prize.amount;
      totals[prize.kind][0] += value;
      totals[prize.kind][1] += 1;
    }
    expect(totals.currency[0] / totals.currency[1]).toBeCloseTo(expected.currency, -1);
    expect(totals.xp[0] / totals.xp[1]).toBeCloseTo(expected.xp, 0);
    expect(Math.abs(totals.item[0] / totals.item[1] - expected.item) / expected.item).toBeLessThan(0.1);
    expect(totals.currency[1] / 60_000).toBeCloseTo(1 / 3, 1);
  });

  it("付费价格公式", () => {
    const definition = fixture().gachas.daily;
    expect([1, 2, 3].map((n) => paidDrawPrice(definition, n))).toEqual([50, 100, 200]);
    expect(paidDrawPrice({ ...definition, paidPrice: { base: 150, growth: 1.5 } }, 2)).toBe(225);
  });
});

describe("预算锚点估算", () => {
  it("探险者山麓的经验效率与 UE-05 的记录一致", () => {
    const income = estimateMapIncome(bundledCatalog.maps["map-1"], bundledCatalog);
    expect((income.xp / income.durationMs) * 3_600_000).toBeCloseTo(22.17, 1);
  });
});

describe("抽奖配置校验", () => {
  it("内置抽奖配置通过校验；旧草稿缺抽奖分类也不报错", () => {
    expect(validateCatalog(bundledCatalog)).toEqual([]);
    const legacy: Partial<Catalog> = structuredClone(bundledCatalog);
    delete legacy.gachas;
    expect(validateCatalog(legacy)).toEqual([]);
  });

  it("道具池引用不存在的物品、价格倍率小于 1 时报错", () => {
    const broken = fixture({ itemPool: [{ itemId: "no-such-item", weight: 1 }], paidPrice: { base: 50, growth: 0.5 } });
    const paths = validateCatalog(broken).map((issue) => issue.path);
    expect(paths).toContain("gachas.daily.itemPool.0.itemId");
    expect(paths).toContain("gachas.daily.paidPrice");
  });
});
