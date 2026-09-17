import { describe, expect, it } from "vitest";
import { rarityChestFx, topLootRarity } from "./chestRarity";
import { RARITIES, type Rarity } from "../domain/rarity";

const rarities: Record<string, Rarity> = {
  paper: "common", rope: "common", herb: "uncommon", gem: "rare", relic: "legendary",
};
const top = (loot: Record<string, number>) => topLootRarity(loot, id => rarities[id]);

describe("开箱动画按战利品稀有度选", () => {
  it("只有普通物品时返回 common，交给调用方维持原来的木箱动画", () => {
    expect(top({ paper: 3, rope: 1 })).toBe("common");
    expect(top({})).toBe("common");
    expect(topLootRarity(undefined, id => rarities[id])).toBe("common");
  });

  it("取最高的那一档，和物品数量、排列顺序都无关", () => {
    expect(top({ paper: 99, herb: 1 })).toBe("uncommon");
    expect(top({ relic: 1, gem: 5, paper: 2 })).toBe("legendary");
    expect(top({ paper: 2, gem: 5, relic: 1 })).toBe("legendary");
  });

  it("数量为 0 的条目不参与判定：拾取后留下的空条目不该让动画升档", () => {
    expect(top({ paper: 1, relic: 0 })).toBe("common");
  });

  it("查不到的物品不会顶掉已知的稀有度，也不会让判定崩掉", () => {
    expect(top({ "不存在的物品": 1 })).toBe("common");
    expect(top({ "不存在的物品": 1, gem: 1 })).toBe("rare");
  });
});

describe("稀有度素材查表", () => {
  it("六档全部配齐了闭合首帧、视频和末帧", () => {
    for (const rarity of RARITIES) {
      const fx = rarityChestFx(rarity);
      expect(fx, rarity).not.toBeNull();
      expect(fx!.closed, rarity).toMatch(/closed-still\.webp/);
      expect(fx!.clip, rarity).toMatch(/open-anim\.mp4/);
      expect(fx!.still, rarity).toMatch(/open-still\.webp/);
    }
  });

  it("没有素材的稀有度返回 null，让调用方回退到通用木箱，而不是画个空箱子", () => {
    // 目前六档都齐了，所以拿一个不存在的档位来验这条回退路径确实还在。
    expect(rarityChestFx("legendary-plus" as Rarity)).toBeNull();
  });

  it("三张素材必须同时存在：缺一张就整档回退，不能出现闭合图和视频对不上的中间态", () => {
    // 查表是「三者都有才返回」，所以不存在只拿到 clip 却没有 closed 的情况。
    const fx = rarityChestFx("mythic")!;
    expect(new Set([fx.closed, fx.clip, fx.still]).size).toBe(3);
  });
});
