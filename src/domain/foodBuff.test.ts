import { describe, expect, it } from "vitest";
import { bundledCatalog } from "./catalog";
import {
  cargoSlotCapacity, createInitialState, eatCargoFood, GameRuleError, healPetWithFood,
  mapInformationTier, startExpedition, teamCarryCapacity, teamSecondaryStat, teamStat,
  teamStatForPets, tick,
} from "./engine";
import type { Catalog, GameState } from "./types";

const PET = "gugugaga";

/**
 * 夹具**先清空所有食物效果再逐件声明**，不是在内置目录上叠加。
 * 叠加的写法会随配表漂移：策划给罐头配了 foodBuff 之后，本来用来测
 * 「纯治疗食物」的那件就悄悄变成了两种效果都有，测试意思全变而且照样绿。
 */
function fixture(): Catalog {
  const catalog = structuredClone(bundledCatalog);
  for (const item of Object.values(catalog.items)) {
    delete item.foodBuff;
    delete item.foodHeal;
  }
  catalog.items.chocolate.foodBuff = { stat: "fitness", amount: 2 };      // 纯 buff
  catalog.items["coffee-beans"].foodBuff = { stat: "perception", amount: 3 };
  catalog.items.honey.foodBuff = { stat: "technique", amount: 2 };
  catalog.items["canned-food"].foodHeal = { steps: 1 };                   // 纯治疗
  catalog.items["red-wine"].foodBuff = { stat: "fitness", amount: 1 };    // 两者都有
  catalog.items["red-wine"].foodHeal = { steps: 2 };
  return catalog;
}

/** 三宠队伍：容量型加成是「逐宠加」还是「队伍级加」只有多宠时才分得出来。 */
function team3(cargo: Record<string, number> = {}) {
  const catalog = fixture();
  let state = createInitialState();
  const base = state.pets[PET];
  state.pets = {
    ...state.pets,
    "pet-b": { ...structuredClone(base), id: "pet-b", name: "队友乙" },
    "pet-c": { ...structuredClone(base), id: "pet-c", name: "队友丙" },
  };
  state.inventory = { ...state.inventory, ...cargo };
  state = startExpedition(state, { mapId: "map-1", petIds: [PET, "pet-b", "pet-c"], cargo }, 1, catalog);
  state = tick(state, state.expeditions[0].arriveAt, catalog);
  return { state, catalog, id: state.expeditions[0].id };
}

/** 抵达第一个节点、可以整理背包的状态。 */
function atNode(cargo: Record<string, number> = {}, catalog = fixture()) {
  let state = createInitialState();
  state.inventory = { ...state.inventory, ...cargo };
  state = startExpedition(state, { mapId: "map-1", petIds: [PET], cargo }, 1, catalog);
  state = tick(state, state.expeditions[0].arriveAt, catalog);
  return { state, catalog, id: state.expeditions[0].id };
}

describe("食物 buff · 加在哪一层", () => {
  it("加到队伍结算结果上", () => {
    const { state, catalog, id } = atNode({ chocolate: 1 });
    const before = teamStat(state, state.expeditions[0], "fitness");
    const after = eatCargoFood(state, id, "chocolate", undefined, 2, catalog);
    expect(teamStat(after, after.expeditions[0], "fitness")).toBe(before + 2);
  });

  // 这两条必须用三宠队伍：单宠时「逐宠加」和「队伍级加」结果恒等，断言会变成空的。
  // （主属性上两者本来就恒等——协助是 min(1,值)、早已饱和在 1——所以只有容量分得出来。）
  it("负重加成只加一次，不随队伍人数放大", () => {
    const { state, catalog, id } = team3({ chocolate: 1 });
    expect(state.expeditions[0].petIds).toHaveLength(3);
    const before = teamCarryCapacity(state, state.expeditions[0], catalog);
    const fed = eatCargoFood(state, id, "chocolate", undefined, 2, catalog);
    // CARRY_PER_FITNESS = 1.2，体能 +2 → +2.4；逐宠加会是 +7.2
    expect(teamCarryCapacity(fed, fed.expeditions[0], catalog)).toBeCloseTo(before + 2.4, 5);
  });

  it("格子加成只加一次，不随队伍人数放大", () => {
    const { state, catalog, id } = team3({ honey: 1 });
    const before = cargoSlotCapacity(state, state.expeditions[0], catalog);
    const fed = eatCargoFood(state, id, "honey", undefined, 2, catalog);
    // SLOTS_PER_TECHNIQUE = 1，技巧 +2 → +2 格；逐宠加会是 +6
    expect(cargoSlotCapacity(fed, fed.expeditions[0], catalog)).toBe(before + 2);
  });

  it("感知 buff 会抬高地图情报等级", () => {
    const { state, catalog, id } = atNode({ "coffee-beans": 1 });
    catalog.maps["map-1"].informationThresholds = { partial: 2, full: 99 };
    const fed = eatCargoFood(state, id, "coffee-beans", undefined, 2, catalog);
    const before = mapInformationTier(state, "map-1", [PET], catalog);
    catalog.maps["map-1"].informationThresholds = {
      partial: 2,
      full: teamStat(fed, fed.expeditions[0], "perception"),
    };
    expect(mapInformationTier(fed, "map-1", [PET], catalog)).toBe(3);
    expect(before).toBeLessThan(3);
  });

  it("teamStatForPets 反查真远征，否则路线门槛的可用性和提示文字会打架", () => {
    const { state, catalog, id } = atNode({ chocolate: 1 });
    const fed = eatCargoFood(state, id, "chocolate", undefined, 2, catalog);
    // 只有 petIds 的这条路（routeHint 走的）必须和带 expedition 的那条（判定走的）一致
    expect(teamStatForPets(fed, [PET], "fitness")).toBe(
      teamStat(fed, fed.expeditions[0], "fitness"),
    );
  });

  it("不碰次要属性——次要属性是硬门槛，能加就等于食物是钥匙", () => {
    const { state, catalog, id } = atNode({ chocolate: 1, "coffee-beans": 1 });
    const before = (["eloquence", "lore", "courage", "guile"] as const).map(k =>
      teamSecondaryStat(state, [PET], k));
    let fed = eatCargoFood(state, id, "chocolate", undefined, 2, catalog);
    fed = eatCargoFood(fed, id, "coffee-beans", undefined, 3, catalog);
    expect((["eloquence", "lore", "courage", "guile"] as const).map(k =>
      teamSecondaryStat(fed, [PET], k))).toEqual(before);
  });
});

describe("食物 buff · 单槽与快照", () => {
  it("同时只有一个，后吃的顶掉前面的", () => {
    const { state, catalog, id } = atNode({ chocolate: 1, "coffee-beans": 1 });
    let fed = eatCargoFood(state, id, "chocolate", undefined, 2, catalog);
    expect(fed.expeditions[0].foodBuff).toMatchObject({ stat: "fitness", amount: 2 });
    fed = eatCargoFood(fed, id, "coffee-beans", undefined, 3, catalog);
    expect(fed.expeditions[0].foodBuff).toMatchObject({ itemId: "coffee-beans", stat: "perception", amount: 3 });
    // 被顶掉的体能加成必须真的没了
    expect(teamStat(fed, fed.expeditions[0], "fitness"))
      .toBe(teamStat(state, state.expeditions[0], "fitness"));
  });

  it("加成是吃下那一刻的快照：改目录数值不影响在途的远征", () => {
    const { state, catalog, id } = atNode({ chocolate: 1 });
    const fed = eatCargoFood(state, id, "chocolate", undefined, 2, catalog);
    const buffed = teamStat(fed, fed.expeditions[0], "fitness");
    catalog.items.chocolate.foodBuff = { stat: "fitness", amount: 99 };
    expect(teamStat(fed, fed.expeditions[0], "fitness")).toBe(buffed);
  });

  it("物品被删出目录后，在途 buff 照常生效——容量不会回落导致超格", () => {
    const { state, catalog, id } = atNode({ chocolate: 1 });
    const fed = eatCargoFood(state, id, "chocolate", undefined, 2, catalog);
    const capacity = teamCarryCapacity(fed, fed.expeditions[0], catalog);
    delete (catalog.items as Record<string, unknown>).chocolate;
    expect(teamCarryCapacity(fed, fed.expeditions[0], catalog)).toBe(capacity);
  });
});

describe("食物 · 吃的时机", () => {
  it("行进途中不能吃", () => {
    const catalog = fixture();
    const state = startExpedition(
      { ...createInitialState(), inventory: { chocolate: 1 } },
      { mapId: "map-1", petIds: [PET], cargo: { chocolate: 1 } }, 1, catalog,
    );
    expect(() => eatCargoFood(state, state.expeditions[0].id, "chocolate", undefined, 2, catalog))
      .toThrow(GameRuleError);
  });

  it("背包里没有就吃不了：不能吃还没拾取的战利品", () => {
    const { state, catalog, id } = atNode();
    state.expeditions[0].pendingLoot = { chocolate: 1 };
    expect(() => eatCargoFood(state, id, "chocolate", undefined, 2, catalog)).toThrow(/背包里没有/);
  });

  it("出发前是「选定」：出发那一刻才从仓库扣，反悔不消耗", () => {
    const catalog = fixture();
    const base: GameState = { ...createInitialState(), inventory: { chocolate: 1 } };
    const launched = startExpedition(base, { mapId: "map-1", petIds: [PET], foodItemId: "chocolate" }, 1, catalog);
    expect(launched.inventory.chocolate ?? 0).toBe(0);
    expect(launched.expeditions[0].foodBuff).toMatchObject({ stat: "fitness", amount: 2 });
    // 原状态没被改动，等于玩家退回上一步时食物还在
    expect(base.inventory.chocolate).toBe(1);
  });

  it("出发前选一份没有 buff 的食物会被拦下，而不是白白吃掉", () => {
    const catalog = fixture();
    const base: GameState = { ...createInitialState(), inventory: { "canned-food": 1 } };
    expect(() => startExpedition(base, { mapId: "map-1", petIds: [PET], foodItemId: "canned-food" }, 1, catalog))
      .toThrow(/没有出发前可用的效果/);
  });
});

describe("食物 · 治疗", () => {
  function injured(stage: "injured" | "incapacitated", inventory: Record<string, number>) {
    const state = createInitialState();
    state.inventory = inventory;
    state.pets[PET] = { ...state.pets[PET], injury: stage, injuryRecoveredAt: 5_000 };
    return state;
  }

  it("基地治疗按档走，一档食物不会把失能直接治成健康", () => {
    const catalog = fixture();
    const healed = healPetWithFood(injured("incapacitated", { "canned-food": 1 }), PET, "canned-food", 10, catalog);
    expect(healed.pets[PET].injury).toBe("injured");
    expect(healed.inventory["canned-food"] ?? 0).toBe(0);
    // 还没好透，下一档重新计时
    expect(healed.pets[PET].injuryRecoveredAt).toBeGreaterThan(10);
  });

  it("档数够就一路治到健康，不会越过 healthy", () => {
    const catalog = fixture();
    const healed = healPetWithFood(injured("injured", { "red-wine": 1 }), PET, "red-wine", 10, catalog);
    expect(healed.pets[PET].injury).toBe("healthy");
    expect(healed.pets[PET].injuryRecoveredAt).toBeUndefined();
  });

  it("没受伤、或宠物在外面时，基地治疗都拒绝", () => {
    const catalog = fixture();
    expect(() => healPetWithFood({ ...createInitialState(), inventory: { "canned-food": 1 } }, PET, "canned-food", 10, catalog))
      .toThrow(/没有受伤/);
    const away = atNode({ "canned-food": 1 });
    away.state.pets[PET] = { ...away.state.pets[PET], injury: "injured" };
    away.state.inventory = { "canned-food": 1 };
    expect(() => healPetWithFood(away.state, PET, "canned-food", 10, away.catalog))
      .toThrow(/正在冒险途中/);
  });

  it("途中吃治疗食物：改档位，且不占 buff 槽", () => {
    const { state, catalog, id } = atNode({ "canned-food": 1 });
    state.pets[PET] = { ...state.pets[PET], injury: "injured" };
    const fed = eatCargoFood(state, id, "canned-food", PET, 2, catalog);
    expect(fed.pets[PET].injury).toBe("healthy");
    expect(fed.expeditions[0].foodBuff).toBeUndefined();
  });

  it("队里没人需要治疗时，纯治疗食物吃不了；带 buff 的照常能吃", () => {
    const pure = atNode({ "canned-food": 1 });
    expect(() => eatCargoFood(pure.state, pure.id, "canned-food", undefined, 2, pure.catalog))
      .toThrow(/没有需要治疗的宠物/);
    const both = atNode({ "red-wine": 1 });
    const fed = eatCargoFood(both.state, both.id, "red-wine", undefined, 2, both.catalog);
    expect(fed.expeditions[0].foodBuff).toMatchObject({ stat: "fitness", amount: 1 });
  });
});
