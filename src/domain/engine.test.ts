import { describe, expect, it } from "vitest";
import { bundledCatalog } from "./catalog";
import {
  GameRuleError,
  addInventory,
  allocateStat,
  applySecondaryGrantItem,
  applyTagItem,
  cargoCapacity,
  cargoSlotCapacity,
  chooseRoute,
  completeTask,
  confirmExtraction,
  createInitialState,
  discardCargo,
  drawNodeLoot,
  pickupAllNodeLoot,
  finishNodeLoot,
  getRiskPreview,
  getRouteAvailability,
  getVisibleRoutes,
  healPet,
  inventorySlots,
  inventoryWeight,
  isChoiceAvailable,
  lockedNodeEvents,
  lootXp,
  mapInformationTier,
  mapXpMultiplier,
  maxLevel,
  overloadRatio,
  nodeLootMaximumRarity,
  xpToNextLevel,
  requestExtraction,
  recordMilestone,
  resolveEvent,
  secondaryStatCap,
  sellCargoItem,
  startExpedition,
  taskCanComplete,
  taskIsAvailable,
  teamSecondaryStat,
  teamStatForPets,
  tick,
} from "./engine";
import type {
  Catalog,
  GameState,
  ItemDefinition,
  NodeLootDefinition,
  SecondaryStats,
} from "./types";

// 数值断言不要绑在真实物品上：目录里的重量、堆叠和售价会随策划反复锚定，
// 绑上去的话每次调数值都会弄坏一批与数值无关的规则测试。
// 需要"一件重 4 的东西"或"一件不能堆叠的东西"时，在这里注入即可。
function catalogWith(
  items: Record<string, Partial<ItemDefinition>>,
): Catalog {
  const next = structuredClone(bundledCatalog);
  for (const [id, patch] of Object.entries(items)) {
    next.items[id] = {
      id,
      name: id,
      rarity: "common",
      weight: 1,
      sellable: true,
      sellValue: 1,
      ...patch,
    };
  }
  // 规则测试自带最小事件、事件池和任务，不依赖策划目录是否保留示例内容。
  next.events["event-shelves"] = {
    id: "event-shelves",
    title: "测试整理事件",
    description: "只用于覆盖事件状态机。",
    choices: [
      {
        id: "sort-carefully",
        label: "仔细整理",
        description: "稳定通过的测试选项。",
        stat: "perception",
        difficulty: -10,
        rewards: {},
      },
    ],
  };
  next.events["event-vent"] = {
    id: "event-vent",
    title: "测试门禁事件",
    description: "只用于覆盖事件门禁。",
    requiredSecondary: { stat: "courage", value: 4 },
    choices: [
      {
        id: "inspect-vent",
        label: "检查",
        description: "测试选项。",
        stat: "perception",
        difficulty: 1,
        rewards: {},
      },
    ],
  };
  next.events["event-backroom"] = {
    id: "event-backroom",
    title: "测试高风险事件",
    description: "用于覆盖大失败。",
    choices: [
      {
        id: "pry-lock",
        label: "撬锁",
        description: "高风险测试选项。",
        stat: "technique",
        difficulty: 10,
        rewards: {},
      },
    ],
  };
  next.eventPools["pool-shelves"] = {
    id: "pool-shelves",
    eventIds: ["event-shelves", "event-vent"],
  };
  next.eventPools["pool-backroom"] = {
    id: "pool-backroom",
    eventIds: ["event-backroom"],
  };
  // 撤离规则测试不能依赖策划是否把真实的探险者营地设为撤离点。
  next.maps["map-1"].nodes["m1-point-1"].extractable = true;
  next.maps["map-1"].nodes["m1-point-1"].eventPoolIds = ["pool-shelves"];
  next.maps["map-1"].nodes["m1-goal-1"].eventPoolIds = ["pool-backroom"];
  next.tasks["task-first-haul"] = {
    id: "task-first-haul",
    title: "测试首次收获",
    description: "只用于覆盖任务消耗与账号奖励。",
    requirement: { items: { paper: 3, screw: 2 } },
    reward: { currency: 20, warehouseSlots: 10 },
  };
  return next;
}

const ruleCatalog = catalogWith({});

function withSecondary(
  state: GameState,
  petId: string,
  patch: Partial<SecondaryStats>,
): GameState {
  const next = structuredClone(state);
  next.pets[petId].secondaryStats = {
    ...next.pets[petId].secondaryStats,
    ...patch,
  };
  return next;
}

function arriveMap1(startAt = 1_000, catalog: Catalog = ruleCatalog): GameState {
  let state = createInitialState();
  state = startExpedition(
    state,
    { mapId: "map-1", petIds: ["gugugaga"] },
    startAt,
    catalog,
  );
  state = tick(state, state.expeditions[0].arriveAt, catalog);
  state = chooseRoute(
    state,
    state.expeditions[0].id,
    "route-1",
    state.expeditions[0].arriveAt,
    catalog,
  );
  state = tick(state, state.expeditions[0].arriveAt, catalog);
  // These event-rule fixtures begin after the player has finished manual pickup.
  state = pickupAllNodeLoot(state, state.expeditions[0].id, startAt, catalog);
  return finishNodeLoot(state, state.expeditions[0].id, true, startAt);
}

describe("initial expedition cargo", () => {
  it("allows at most three pets in one expedition team", () => {
    const makeState = () => {
      const state = createInitialState();
      const template = structuredClone(state.pets.gugugaga);
      for (let index = 2; index <= 4; index += 1) {
        state.pets[`pet-${index}`] = {
          ...structuredClone(template),
          id: `pet-${index}`,
          name: `Pet ${index}`,
        };
      }
      return state;
    };

    expect(() =>
      startExpedition(
        makeState(),
        { mapId: "map-1", petIds: ["gugugaga", "pet-2", "pet-3"] },
        1_000,
        ruleCatalog,
      ),
    ).not.toThrow();
    expect(() =>
      startExpedition(
        makeState(),
        {
          mapId: "map-1",
          petIds: ["gugugaga", "pet-2", "pet-3", "pet-4"],
        },
        1_000,
        ruleCatalog,
      ),
    ).toThrow("一支队伍最多编入 3 只宠物");
  });

  it("atomically moves selected warehouse items into the expedition cargo", () => {
    const catalog = catalogWith({
      "probe-kit": { weight: 0.5, stackSize: 20 },
    });
    const source = createInitialState();
    source.inventory["probe-kit"] = 5;

    const started = startExpedition(
      source,
      {
        mapId: "map-1",
        petIds: ["gugugaga"],
        cargo: { "probe-kit": 3 },
      },
      1_000,
      catalog,
    );

    expect(source.inventory["probe-kit"]).toBe(5);
    expect(started.inventory["probe-kit"]).toBe(2);
    expect(started.expeditions[0].cargo).toEqual({ "probe-kit": 3 });
    expect(started.expeditions[0].initialCargo).toEqual({ "probe-kit": 3 });
  });

  it("rejects unknown, invalid, insufficient, or over-slot initial cargo", () => {
    const catalog = catalogWith({
      "probe-kit": { stackSize: 20 },
      "probe-single": { stackSize: 1 },
    });
    const state = createInitialState();
    state.inventory = { "probe-kit": 2, "probe-single": 100 };
    const dispatch = (cargo: Record<string, number>) =>
      startExpedition(
        state,
        { mapId: "map-1", petIds: ["gugugaga"], cargo },
        1_000,
        catalog,
      );

    expect(() => dispatch({ missing: 1 })).toThrow("携带物品不存在");
    expect(() => dispatch({ "probe-kit": 1.5 })).toThrow("正整数");
    expect(() => dispatch({ "probe-kit": 3 })).toThrow("仓库物品不足");
    expect(() => dispatch({ "probe-single": 100 })).toThrow("超过队伍背包上限");
    expect(state.inventory).toEqual({ "probe-kit": 2, "probe-single": 100 });
    expect(state.expeditions).toEqual([]);
  });

  it("allows overweight initial cargo because weight is a risk gradient", () => {
    const catalog = catalogWith({
      "probe-heavy-kit": { weight: 100, stackSize: 20 },
    });
    const state = createInitialState();
    state.inventory["probe-heavy-kit"] = 1;
    const started = startExpedition(
      state,
      {
        mapId: "map-1",
        petIds: ["gugugaga"],
        cargo: { "probe-heavy-kit": 1 },
      },
      1_000,
      catalog,
    );
    expect(overloadRatio(started, started.expeditions[0], catalog)).toBeGreaterThan(1);
  });

  it("does not award loot XP again for items brought from the warehouse", () => {
    const catalog = catalogWith({
      "probe-protected": { rarity: "epic", weight: 1, stackSize: 20 },
    });
    const base = createInitialState();
    base.inventory["probe-protected"] = 1;
    let state = startExpedition(
      base,
      {
        mapId: "map-1",
        petIds: ["gugugaga"],
        cargo: { "probe-protected": 1 },
      },
      1_000,
      catalog,
    );
    const id = state.expeditions[0].id;
    state.expeditions[0].phase = "extraction";
    state.expeditions[0].currentNodeId = "m1-point-1";
    state = confirmExtraction(state, id, 3_000, catalog);
    expect(state.inventory["probe-protected"]).toBe(1);
    expect(state.settlements[0].xpAward).toBe(0);

    state = startExpedition(
      state,
      {
        mapId: "map-1",
        petIds: ["gugugaga"],
        cargo: { "probe-protected": 1 },
      },
      4_000,
      catalog,
    );
    const secondId = state.expeditions[0].id;
    state.expeditions[0].phase = "extraction";
    state.expeditions[0].currentNodeId = "m1-point-1";
    state = sellCargoItem(
      state,
      secondId,
      "probe-protected",
      1,
      5_000,
      catalog,
    );
    state = confirmExtraction(state, secondId, 6_000, catalog);
    expect(state.settlements[0].xpAward).toBe(0);
  });
});

describe("asynchronous expedition state machine", () => {
  it("treats the start node as a reward-free route entrance", () => {
    let state = createInitialState();
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
    );
    state = tick(state, state.expeditions[0].arriveAt);

    expect(state.expeditions[0].currentNodeId).toBe("m1-start");
    expect(state.expeditions[0].phase).toBe("awaiting-route");
    expect(state.expeditions[0].currentEventId).toBeUndefined();
    expect(state.expeditions[0].arrivalLoot).toEqual({});
    expect(state.expeditions[0].cargo).toEqual({});
    expect(state.expeditions[0].completedNodeCount).toBe(0);
  });

  it("allows the start entrance to branch toward multiple first targets", () => {
    const catalog = structuredClone(bundledCatalog);
    catalog.maps["map-1"].nodes["m1-start"].edges.push({
      id: "route-direct-backroom",
      label: "直接前往里间",
      description: "入口的第二个首层目标。",
      toNodeId: "m1-goal-1",
      durationMs: 5_000,
    });
    let state = createInitialState();
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
      catalog,
    );
    state = tick(state, state.expeditions[0].arriveAt, catalog);

    const entranceRouteIds = catalog.maps["map-1"].nodes[
      "m1-start"
    ].edges.map((edge) => edge.id);
    expect(entranceRouteIds).toContain("route-direct-backroom");
    expect(entranceRouteIds.length).toBeGreaterThan(1);
    state = chooseRoute(
      state,
      state.expeditions[0].id,
      "route-direct-backroom",
      10_000,
      catalog,
    );
    expect(state.expeditions[0].targetNodeId).toBe("m1-goal-1");
    expect(state.expeditions[0].phase).toBe("traveling");
  });

  it("skips event decisions on nodes without event pools", () => {
    function arriveWithoutEvent(terminal: boolean): GameState {
      const catalog = structuredClone(bundledCatalog);
      const node = catalog.maps["map-1"].nodes["m1-point-1"];
      node.eventPoolIds = [];
      node.terminal = terminal;
      let state = createInitialState();
      state = startExpedition(
        state,
        { mapId: "map-1", petIds: ["gugugaga"] },
        1_000,
        catalog,
      );
      state = tick(state, state.expeditions[0].arriveAt, catalog);
      state = chooseRoute(
        state,
        state.expeditions[0].id,
        "route-1",
        2_000,
        catalog,
      );
      return tick(state, state.expeditions[0].arriveAt, catalog);
    }

    const routeNode = arriveWithoutEvent(false).expeditions[0];
    expect(routeNode.phase).toBe("awaiting-route");
    expect(routeNode.currentEventId).toBeUndefined();
    expect(routeNode.drawnEventIds).toEqual([]);
    expect(routeNode.completedNodeCount).toBe(1);

    const terminalNode = arriveWithoutEvent(true).expeditions[0];
    expect(terminalNode.phase).toBe("extraction");
    expect(terminalNode.currentEventId).toBeUndefined();
  });

  it("stops at an arrived node and never punishes a late return", () => {
    const arrived = arriveMap1();
    expect(arrived.expeditions[0].phase).toBe("awaiting-event");
    const eventId = arrived.expeditions[0].currentEventId;
    const petBefore = structuredClone(arrived.pets["gugugaga"]);

    const muchLater = tick(arrived, Date.now() + 365 * 24 * 60 * 60 * 1_000);

    expect(muchLater.expeditions[0].phase).toBe("awaiting-event");
    expect(muchLater.expeditions[0].currentEventId).toBe(eventId);
    expect(muchLater.pets["gugugaga"]).toEqual(petBefore);
  });

  it("resolves the current event before allowing a route commitment", () => {
    let state = arriveMap1(2_000);
    const expeditionId = state.expeditions[0].id;

    // 这条只验证状态机顺序；抵达掉落导致的超载与事件风险由独立用例覆盖。
    state.expeditions[0].cargo = {};
    state = resolveEvent(
      state,
      expeditionId,
      "sort-carefully",
      3_000,
      ruleCatalog,
    );
    expect(state.expeditions[0].phase).toBe("awaiting-route");
    expect(state.expeditions[0].lastResolution).toBeDefined();

    state = chooseRoute(state, expeditionId, "route-2", 4_000);
    expect(state.expeditions[0].phase).toBe("traveling");
    expect(state.expeditions[0].targetNodeId).toBe("m1-goal-1");
  });

  it("幸运儿在事件检定中掷两次 D6 取高，且多个优势 Tag 不叠加", () => {
    const catalog = catalogWith({});
    catalog.events["event-shelves"].choices[0].difficulty = 5;
    catalog.tags["tag-lucky-copy"] = {
      id: "tag-lucky-copy",
      name: "测试幸运副本",
      description: "验证多个优势 Tag 仍只掷两次。",
      eventRollAdvantage: true,
    };

    const prepare = (tagIds: string[]) => {
      const state = arriveMap1(1_000, catalog);
      state.expeditions[0].cargo = {};
      // seed 53 的前两颗 D6 固定为 1、6，适合证明检定确实取了较高值。
      state.expeditions[0].currentSeed = 53;
      state.pets.gugugaga.growthTagIds = tagIds;
      return state;
    };

    const plainReady = prepare([]);
    const plain = resolveEvent(
      plainReady,
      plainReady.expeditions[0].id,
      "sort-carefully",
      2_000,
      catalog,
    );
    expect(plain.expeditions[0].lastResolution?.outcome).toBe("big-failure");
    expect(plain.pets.gugugaga.injury).toBe("injured");

    const luckyReady = prepare(["tag-lucky", "tag-lucky-copy"]);
    const lucky = resolveEvent(
      luckyReady,
      luckyReady.expeditions[0].id,
      "sort-carefully",
      2_000,
      catalog,
    );
    expect(lucky.expeditions[0].lastResolution?.outcome).toBe("success");
    expect(lucky.expeditions[0].lastResolution?.summary).toContain(
      "幸运儿掷出 1、6，取较高的 6。",
    );
  });

  it("按地图感知门槛显示三档事件情报，并把幸运儿计入完整概率", () => {
    const previewAt = (
      difficulty: number,
      tier: 1 | 2 | 3,
      lucky = false,
    ) => {
      const catalog = catalogWith({});
      catalog.events["event-shelves"].choices[0].difficulty = difficulty;
      catalog.events["event-shelves"].choices[0].stat = "fitness";
      catalog.maps["map-1"].informationThresholds =
        tier === 1 ? { partial: 3, full: 4 } : { partial: 2, full: 4 };
      const state = arriveMap1(1_000, catalog);
      state.expeditions[0].cargo = {};
      state.expeditions[0].currentEventId = "event-shelves";
      state.pets.gugugaga.growthTagIds = lucky ? ["tag-lucky"] : [];
      if (tier === 3) state.pets.gugugaga.allocatedStats.perception = 2;
      return getRiskPreview(
        state,
        state.expeditions[0].id,
        "sort-carefully",
        catalog,
      );
    };

    expect(previewAt(7, 1)).toMatchObject({
      label: "风险未知",
      detail: "当前情报不足，无法判断这个选择的危险程度。",
      bigFailureProbability: null,
    });
    expect(previewAt(3, 2)).toMatchObject({
      label: "稳妥",
      bigFailureProbability: 0,
    });
    expect(previewAt(4, 2)).toMatchObject({
      label: "冒险",
      bigFailureProbability: 1 / 6,
    });
    expect(previewAt(6, 2)).toMatchObject({
      label: "危险",
      bigFailureProbability: 1 / 2,
    });
    expect(previewAt(7, 2)).toMatchObject({
      label: "极其危险",
      bigFailureProbability: 2 / 3,
    });
    expect(previewAt(2, 3)).toMatchObject({
      label: "稳妥",
      detail: "大成功 16.7% · 成功 50% · 失败 33.3% · 大失败 0%",
      bigFailureProbability: 0,
    });
    expect(previewAt(2, 3, true)).toMatchObject({
      label: "稳妥",
      detail:
        "大成功 30.6% · 成功 58.3% · 失败 11.1% · 大失败 0%（幸运儿：两次掷骰取高）",
      bigFailureProbability: 0,
    });
  });

  it("按新的四档差值边界结算主属性事件", () => {
    const outcomeAt = (seed: number, difficulty = 2) => {
      const catalog = catalogWith({});
      catalog.events["event-shelves"].choices[0].difficulty = difficulty;
      const state = arriveMap1(1_000, catalog);
      state.expeditions[0].cargo = {};
      state.expeditions[0].currentEventId = "event-shelves";
      state.expeditions[0].currentSeed = seed;
      return resolveEvent(
        state,
        state.expeditions[0].id,
        "sort-carefully",
        2_000,
        catalog,
      ).expeditions[0].lastResolution?.outcome;
    };

    // 难度 2 与队伍感知 2 抵消，风险值为 0：D6 的 1、2 失败，
    // 3～5 成功，6 大成功，不会大失败。
    expect(outcomeAt(1)).toBe("failure");
    expect(outcomeAt(2_688)).toBe("failure");
    expect(outcomeAt(5_376)).toBe("success");
    expect(outcomeAt(10_752)).toBe("success");
    expect(outcomeAt(13_312)).toBe("extra-success");
    // 风险值为 2 时掷出 1，差值 -1，进入大失败。
    expect(outcomeAt(1, 4)).toBe("big-failure");
  });

  it("requires overloaded cargo to be discarded before immediate extraction", () => {
    // 单重 1、堆叠够大（让格子不干扰，这里只测负重）：
    // 装到刚好超出负重上限一件，丢一件就应该正好合规。
    const catalog = catalogWith({ "probe-heavy": { weight: 1, stackSize: 99 } });
    let state = arriveMap1();
    const expeditionId = state.expeditions[0].id;
    state = resolveEvent(state, expeditionId, "sort-carefully", 2_000, catalog);

    const capacity = cargoCapacity(state, state.expeditions[0], catalog);
    const fits = Math.floor(capacity);
    state.expeditions[0].cargo = { "probe-heavy": fits + 1 };
    state = requestExtraction(state, expeditionId, 3_000, catalog);

    expect(() =>
      confirmExtraction(state, expeditionId, 4_000, catalog),
    ).toThrow(GameRuleError);

    state = discardCargo(state, expeditionId, "probe-heavy", 1, 5_000, catalog);
    state = confirmExtraction(state, expeditionId, 6_000, catalog);
    expect(state.expeditions).toHaveLength(0);
    // 没有结算区了：确认撤离的同一步里战利品就已经进了仓库。
    expect(state.inventory).toEqual({ "probe-heavy": fits });
    expect(state.settlements).toHaveLength(1);
    expect(state.settlements[0].cargo).toEqual({ "probe-heavy": fits });
  });

  it("只允许中途撤离点和固定终点撤离，普通节点必须继续前进", () => {
    const catalog = catalogWith({});
    let state = createInitialState();
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
      catalog,
    );
    const expeditionId = state.expeditions[0].id;
    state.expeditions[0].phase = "awaiting-route";
    state.expeditions[0].currentNodeId = "m1-point-2";
    expect(() => requestExtraction(state, expeditionId, 2_000, catalog)).toThrow(
      "当前节点不是撤离点",
    );

    state.expeditions[0].currentNodeId = "m1-point-1";
    state = requestExtraction(state, expeditionId, 3_000, catalog);
    expect(state.expeditions[0].phase).toBe("extraction");
  });

  it("大失败只让随机可行动宠物伤势 +1，全队失能时才溃败", () => {
    const catalog = catalogWith({});
    const prepare = (injury: "healthy" | "injured") => {
      const state = startExpedition(
        createInitialState(),
        { mapId: "map-1", petIds: ["gugugaga"] },
        10_000,
        catalog,
      );
      state.pets.gugugaga.injury = injury;
      state.expeditions[0].phase = "awaiting-event";
      state.expeditions[0].currentNodeId = "m1-goal-1";
      state.expeditions[0].currentEventId = "event-backroom";
      state.expeditions[0].currentSeed = 53;
      return state;
    };

    const survivedReady = prepare("healthy");
    const survived = resolveEvent(
      survivedReady,
      survivedReady.expeditions[0].id,
      "pry-lock",
      11_000,
      catalog,
    );
    expect(survived.pets.gugugaga.injury).toBe("injured");
    expect(survived.expeditions[0].lastResolution?.outcome).toBe("big-failure");
    expect(survived.expeditions[0].phase).toBe("extraction");

    const defeatedReady = prepare("injured");
    const defeated = resolveEvent(
      defeatedReady,
      defeatedReady.expeditions[0].id,
      "pry-lock",
      11_000,
      catalog,
    );
    expect(defeated.pets.gugugaga.injury).toBe("incapacitated");
    expect(defeated.expeditions).toEqual([]);
    expect(defeated.settlements[0].outcome).toBe("defeat");
  });

  it("keeps uncarried warehouse assets but loses cargo when the whole team is defeated", () => {
    const base = createInitialState();
    base.currency = 77;
    base.inventory = { laptop: 2 };
    base.pets.gugugaga.injury = "injured";
    const catalog = catalogWith({});
    const started = startExpedition(
      base,
      {
        mapId: "map-1",
        petIds: ["gugugaga"],
        cargo: { laptop: 1 },
      },
      10_000,
      catalog,
    );

    let defeated: GameState | undefined;
    for (let seed = 1; seed < 500 && !defeated; seed += 1) {
      const candidate = structuredClone(started);
      candidate.expeditions[0].phase = "awaiting-event";
      candidate.expeditions[0].currentNodeId = "m1-goal-1";
      candidate.expeditions[0].currentEventId = "event-backroom";
      candidate.expeditions[0].currentSeed = seed;
      candidate.expeditions[0].completedNodeCount = 1;
      // 大失败让带伤的单宠进入失能，于是全队无人能行动并触发溃败。
      const result = resolveEvent(
        candidate,
        candidate.expeditions[0].id,
        "pry-lock",
        11_000,
        catalog,
      );
      if (
        result.expeditions.length === 0 &&
        result.settlements[0]?.outcome === "defeat"
      ) {
        defeated = result;
      }
    }

    expect(defeated).toBeDefined();
    expect(defeated!.currency).toBe(77);
    expect(defeated!.inventory).toEqual({ laptop: 1 });
    expect(defeated!.pets["gugugaga"].level).toBe(1);
  });

  it("records arrival loot and lets the player discard it before the event", () => {
    let state = arriveMap1();
    const expeditionId = state.expeditions[0].id;
    const report = structuredClone(state.expeditions[0].arrivalLoot);
    const [itemId] = Object.keys(report);

    expect(itemId).toBeDefined();
    expect(state.expeditions[0].cargo[itemId]).toBeGreaterThan(0);

    const cargoBefore = state.expeditions[0].cargo[itemId];
    state = discardCargo(state, expeditionId, itemId, 1, 2_000);
    expect(state.expeditions[0].cargo[itemId] ?? 0).toBe(cargoBefore - 1);
    expect(state.expeditions[0].arrivalLoot).toEqual(report);

    const muchLater = tick(state, Date.now() + 365 * 24 * 60 * 60 * 1_000);
    expect(muchLater.expeditions[0].cargo).toEqual(
      state.expeditions[0].cargo,
    );
    expect(muchLater.expeditions[0].arrivalLoot).toEqual(report);
  });
});

describe("node arrival loot", () => {
  const lootCatalog = catalogWith({
    "drop-common-a": { rarity: "common" },
    "drop-common-b": { rarity: "common" },
    "drop-uncommon": { rarity: "uncommon" },
    "drop-rare": { rarity: "rare" },
    "drop-epic": { rarity: "epic" },
  });

  it("draws independent slots deterministically after whitelist and blacklist filtering", () => {
    const definition: NodeLootDefinition = {
      mode: "independent",
      minCount: 3,
      maxCount: 3,
      rarityWeights: { common: 100 },
      whitelistItemIds: ["drop-common-a", "drop-common-b"],
      blacklistItemIds: ["drop-common-b"],
    };

    const first = drawNodeLoot(definition, 12345, lootCatalog);
    const repeated = drawNodeLoot(definition, 12345, lootCatalog);

    expect(first).toEqual(repeated);
    expect(first.loot).toEqual({ "drop-common-a": 3 });
  });

  it("supports item Tag filters and applies explicit blacklists afterward", () => {
    const taggedCatalog = catalogWith({
      "drop-tagged-a": { rarity: "common", tags: ["test-bulk"] },
      "drop-tagged-b": { rarity: "common", tags: ["test-bulk"] },
      "drop-untagged": { rarity: "common", tags: ["test-other"] },
    });
    const definition: NodeLootDefinition = {
      mode: "independent",
      minCount: 3,
      maxCount: 3,
      rarityWeights: { common: 100 },
      whitelistItemTags: ["test-bulk"],
      blacklistItemIds: ["drop-tagged-b"],
    };

    expect(drawNodeLoot(definition, 12345, taggedCatalog).loot).toEqual({
      "drop-tagged-a": 3,
    });
  });

  it("draws one weighted composition and satisfies its exact rarity counts", () => {
    const definition: NodeLootDefinition = {
      mode: "composition",
      minCount: 5,
      maxCount: 5,
      compositions: [
        {
          id: "fixed-example",
          weight: 1,
          rarityCounts: { common: 2, uncommon: 1, rare: 1, epic: 1 },
        },
      ],
      whitelistItemIds: [
        "drop-common-a",
        "drop-uncommon",
        "drop-rare",
        "drop-epic",
      ],
    };

    expect(drawNodeLoot(definition, 67890, lootCatalog).loot).toEqual({
      "drop-common-a": 2,
      "drop-uncommon": 1,
      "drop-rare": 1,
      "drop-epic": 1,
    });
  });
});

describe("负重求和", () => {
  it("0.1 刻度的重量累加不产生浮点残渣", () => {
    // 0.1 + 0.2 + 0.3 在 IEEE754 下是 0.6000000000000001。
    const catalog = catalogWith({
      "probe-0.1": { weight: 0.1 },
      "probe-0.2": { weight: 0.2 },
      "probe-0.3": { weight: 0.3 },
    });
    expect(
      inventoryWeight(
        { "probe-0.1": 1, "probe-0.2": 1, "probe-0.3": 1 },
        catalog,
      ),
    ).toBe(0.6);
    // 0.1 × 3 是另一条经典残渣路径（0.30000000000000004）。
    expect(inventoryWeight({ "probe-0.1": 3 }, catalog)).toBe(0.3);

    // 这一条盯的是真实目录：每件物品的重量都必须落在 0.1 刻度上，
    // 全部相加也不能漂出刻度。策划调重量时它应该继续生效。
    const everything = Object.fromEntries(
      Object.keys(bundledCatalog.items).map((id) => [id, 1]),
    );
    const total = inventoryWeight(everything);
    expect(total * 10).toBe(Math.round(total * 10));
  });

  it("背包刚好装满负重时不会被误判成超载而拦下撤离", () => {
    // 单件 0.2；未吸附时 0.2 × 12 会得到 2.4000000000000004，
    // 把"刚好装满"判成超载。仓库已经不限重量，这条只保护背包侧。
    // 堆叠开大是为了让格子不干扰这里要测的浮点行为。
    const catalog = catalogWith({
      "probe-strip": { weight: 0.2, stackSize: 999 },
    });

    let state = createInitialState();
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
      catalog,
    );
    const expeditionId = state.expeditions[0].id;
    const capacity = cargoCapacity(state, state.expeditions[0], catalog);
    state.expeditions[0].cargo = { "probe-strip": capacity * 5 };
    state.expeditions[0].phase = "extraction";
    expect(inventoryWeight(state.expeditions[0].cargo, catalog)).toBe(capacity);

    state = confirmExtraction(state, expeditionId, 2_000, catalog);
    expect(state.expeditions).toHaveLength(0);
  });

  it("超载报错里的差值不带浮点残渣", () => {
    let state = createInitialState();
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
    );
    const expeditionId = state.expeditions[0].id;
    const capacity = cargoCapacity(state, state.expeditions[0]);
    // 超出上限 2.2：capacity 是整数，(capacity + 2.2) 用 0.1 件凑出。
    state.expeditions[0].cargo = { keycap: Math.round((capacity + 2.2) * 10) };
    state.expeditions[0].phase = "extraction";

    expect(() => confirmExtraction(state, expeditionId, 2_000)).toThrow(
      "仍然超载 2.2，",
    );
  });

  it("刚好装满不会被判成超载", () => {
    let state = createInitialState();
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
    );
    const expedition = state.expeditions[0];
    const capacity = cargoCapacity(state, expedition);

    // 用 0.1 刻度的物品精确填满背包。
    expedition.cargo = { keycap: capacity * 10 };
    expect(inventoryWeight(expedition.cargo)).toBe(capacity);
    expect(overloadRatio(state, expedition)).toBeLessThanOrEqual(1);
  });
});

describe("account economy and permanent growth", () => {
  it("图鉴累计每次实际获得的物品数量，带出再带回不会重复计数", () => {
    const catalog = catalogWith({});
    catalog.tasks["task-codex-a"] = {
      id: "task-codex-a",
      title: "图鉴计数 A",
      description: "第一次发放三张纸。",
      requirement: {},
      reward: { items: { paper: 3 } },
    };
    catalog.tasks["task-codex-b"] = {
      id: "task-codex-b",
      title: "图鉴计数 B",
      description: "再次发放两张纸。",
      requirement: {},
      reward: { items: { paper: 2 } },
    };

    let state = createInitialState();
    expect(state.itemAcquisitionCounts).toEqual({});
    state = completeTask(state, "task-codex-a", 1_000, catalog);
    state = completeTask(state, "task-codex-b", 2_000, catalog);
    expect(state.itemAcquisitionCounts.paper).toBe(5);
    expect(state.discoveredItemIds).toContain("paper");

    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"], cargo: { paper: 1 } },
      3_000,
      catalog,
    );
    state.expeditions[0].phase = "extraction";
    state.expeditions[0].currentNodeId = "m1-start";
    state = confirmExtraction(state, state.expeditions[0].id, 4_000, catalog);
    expect(state.itemAcquisitionCounts.paper).toBe(5);
  });

  it("玩家里程碑幂等写入存档，并可与其他目标一样驱动任务完成", () => {
    const catalog = catalogWith({});
    catalog.tasks["task-prepare"] = {
      id: "task-prepare",
      title: "冒险前的准备",
      description: "查看出发前需要了解的几个面板。",
      requirement: {
        goals: [
          { type: "milestone", milestoneId: "opened-pets" },
          { type: "milestone", milestoneId: "opened-inventory" },
          { type: "milestone", milestoneId: "opened-adventure" },
          { type: "milestone", milestoneId: "opened-settings" },
        ],
      },
      reward: { currency: 1 },
    };

    let state = createInitialState();
    expect(taskCanComplete(state, "task-prepare", catalog)).toBe(false);
    state = recordMilestone(state, "opened-pets");
    const afterDuplicate = recordMilestone(state, "opened-pets");
    expect(afterDuplicate).toBe(state);
    expect(state.completedMilestoneIds).toEqual(["opened-pets"]);

    state = recordMilestone(state, "opened-inventory");
    state = recordMilestone(state, "opened-adventure");
    expect(taskCanComplete(state, "task-prepare", catalog)).toBe(false);
    state = recordMilestone(state, "opened-settings");
    expect(taskCanComplete(state, "task-prepare", catalog)).toBe(true);

    state = completeTask(state, "task-prepare", 1_000, catalog);
    expect(state.completedTaskIds).toContain("task-prepare");
    expect(state.currency).toBe(1);
  });

  it("consumes ordinary items and pays out an account task reward", () => {
    let state = createInitialState();
    const slotsBefore = state.warehouseSlots;
    state.inventory = { paper: 4, screw: 2 };
    state = completeTask(state, "task-first-haul", 1_000, ruleCatalog);

    expect(state.inventory.paper).toBe(1);
    expect(state.inventory.screw).toBeUndefined();
    expect(state.currency).toBe(20);
    expect(state.warehouseSlots).toBe(slotsBefore + 10);
    expect(state.completedTaskIds).toContain("task-first-haul");
  });

  it("支持物品、货币和首次通关目标的组合条件，并在提交时扣除", () => {
    const catalog = catalogWith({});
    catalog.tasks["task-combined"] = {
      id: "task-combined",
      title: "组合条件任务",
      description: "测试三类条件同时生效。",
      prerequisiteTaskIds: ["task-first-haul"],
      requirement: {
        items: { paper: 1 },
        currency: 10,
        goals: [{ type: "clear-map", mapId: "map-1" }],
      },
      reward: { currency: 3, items: { screw: 2 } },
    };

    let state = createInitialState();
    state.inventory = { paper: 1 };
    state.currency = 10;
    expect(taskIsAvailable(state, "task-combined", catalog)).toBe(false);

    state.completedTaskIds.push("task-first-haul");
    // 从中途撤离点成功撤离过不等于通关地图。
    state.completedExtractionNodeKeys.push("map-1:m1-point-1");
    expect(taskIsAvailable(state, "task-combined", catalog)).toBe(true);
    expect(taskCanComplete(state, "task-combined", catalog)).toBe(false);

    // 只有固定终点的成功撤离记录才能满足 clear-map。
    state.completedExtractionNodeKeys.push("map-1:m1-goal-1");
    expect(taskCanComplete(state, "task-combined", catalog)).toBe(true);
    state = completeTask(state, "task-combined", 1_000, catalog);

    expect(state.inventory).toEqual({ screw: 2 });
    expect(state.currency).toBe(3);
    expect(state.completedTaskIds).toContain("task-combined");
  });

  it("任务奖励物品放不下时阻止提交，扩容奖励可在同次结算生效", () => {
    const catalog = catalogWith({ "probe-task-reward": {} });
    catalog.tasks["task-storage"] = {
      id: "task-storage",
      title: "仓库任务",
      description: "测试奖励入库。",
      requirement: { currency: 1 },
      reward: { items: { "probe-task-reward": 1 } },
    };
    let state = createInitialState();
    state.currency = 1;
    state.warehouseSlots = 0;
    expect(taskCanComplete(state, "task-storage", catalog)).toBe(false);
    expect(() => completeTask(state, "task-storage", 1_000, catalog)).toThrow(
      "任务条件尚未满足",
    );

    catalog.tasks["task-storage"].reward.warehouseSlots = 1;
    expect(taskCanComplete(state, "task-storage", catalog)).toBe(true);
    state = completeTask(state, "task-storage", 2_000, catalog);
    expect(state.inventory).toEqual({ "probe-task-reward": 1 });
    expect(state.warehouseSlots).toBe(1);
  });

  // Tag 载体物品目前没有正式内容（占位的幸运特质结晶已删除），
  // 但"一次性消耗、永久绑定、不可重复"这条规则必须继续被覆盖，
  // 所以这里注入一份只为测试存在的目录。
  it("consumes a rare item and permanently fills one growth Tag slot", () => {
    const tagCatalog = structuredClone(bundledCatalog);
    tagCatalog.items["test-tag-item"] = {
      id: "test-tag-item",
      name: "测试用特质结晶",
      description: "一次性消耗，永久赋予幸运儿 Tag。",
      rarity: "mythic",
      weight: 1,
      sellable: false,
      tagGrantId: "tag-lucky",
    };

    let state = createInitialState();
    state.inventory = { "test-tag-item": 1 };
    state = applyTagItem(state, "gugugaga", "test-tag-item", tagCatalog);

    expect(state.inventory["test-tag-item"]).toBeUndefined();
    expect(state.pets["gugugaga"].growthTagIds).toEqual(["tag-lucky"]);
    expect(() =>
      applyTagItem(
        {
          ...state,
          inventory: addInventory(state.inventory, { "test-tag-item": 1 }),
        },
        "gugugaga",
        "test-tag-item",
        tagCatalog,
      ),
    ).toThrow("宠物已经拥有相同 Tag");
  });

  it("仓库格子不够时拒绝撤离，而不是销毁战利品", () => {
    let state = createInitialState();
    state.warehouseSlots = 2;
    state.inventory = { laptop: 1, paper: 1 };
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
    );
    const expeditionId = state.expeditions[0].id;
    state.expeditions[0].cargo = { screw: 1 };
    state.expeditions[0].phase = "extraction";

    expect(() => confirmExtraction(state, expeditionId, 2_000)).toThrow(
      "仓库放不下",
    );
    // 队伍还在，战利品也还在背包里，什么都没被系统吃掉。
    expect(state.expeditions[0].cargo).toEqual({ screw: 1 });
    expect(state.inventory).toEqual({ laptop: 1, paper: 1 });

    // 卖掉仓库里的一件腾出格子后就能撤离。
    const roomy = { ...state, warehouseSlots: 3 };
    const done = confirmExtraction(roomy, expeditionId, 3_000);
    expect(done.inventory).toEqual({ laptop: 1, paper: 1, screw: 1 });
  });

  it("按具体撤离节点分别发放一次首次撤离奖励", () => {
    const catalog = catalogWith({
      "probe-extraction-prize": { rarity: "rare", weight: 999, stackSize: 99 },
      "probe-extraction-prize-b": { rarity: "rare", weight: 999, stackSize: 99 },
    });
    // m1-point-1 是还能继续前进的中途撤离点，m1-goal-1 是固定终点。
    catalog.maps["map-1"].nodes["m1-point-1"].firstExtractionRewards = {
      "probe-extraction-prize": 1,
      "probe-extraction-prize-b": 1,
    };
    catalog.maps["map-1"].nodes["m1-goal-1"].firstExtractionRewards = {
      "probe-extraction-prize": 1,
    };

    function extractFrom(state: GameState, nodeId: string, now: number): GameState {
      let next = startExpedition(
        state,
        { mapId: "map-1", petIds: ["gugugaga"] },
        now,
        catalog,
      );
      const expedition = next.expeditions[0];
      expedition.phase = "extraction";
      expedition.currentNodeId = nodeId;
      expedition.completedNodeCount = 1;
      return confirmExtraction(next, expedition.id, now + 1, catalog);
    }

    let state = extractFrom(createInitialState(), "m1-point-1", 1_000);
    expect(state.inventory["probe-extraction-prize"]).toBe(1);
    expect(state.inventory["probe-extraction-prize-b"]).toBe(1);
    expect(state.completedExtractionNodeKeys).toContain("map-1:m1-point-1");
    expect(state.settlements[0].firstExtractionRewards).toEqual({
      "probe-extraction-prize": 1,
      "probe-extraction-prize-b": 1,
    });
    expect(state.itemAcquisitionCounts["probe-extraction-prize"]).toBe(1);
    expect(state.itemAcquisitionCounts["probe-extraction-prize-b"]).toBe(1);

    // 同一个中途撤离点再次撤离不重复发；换到同图另一个终点则单独领取。
    state = extractFrom(state, "m1-point-1", 2_000);
    expect(state.inventory["probe-extraction-prize"]).toBe(1);
    expect(state.settlements[0].firstExtractionRewards).toBeUndefined();

    state = extractFrom(state, "m1-goal-1", 3_000);
    expect(state.inventory["probe-extraction-prize"]).toBe(2);
    expect(state.completedExtractionNodeKeys).toContain("map-1:m1-goal-1");
    expect(state.settlements[0].firstExtractionRewards).toEqual({
      "probe-extraction-prize": 1,
    });
    expect(state.itemAcquisitionCounts["probe-extraction-prize"]).toBe(2);
  });

  it("首次撤离奖励不占背包负重，但仓库放不下时不会被吞掉", () => {
    const catalog = catalogWith({
      "probe-heavy-prize": { rarity: "rare", weight: 999, stackSize: 99 },
    });
    catalog.maps["map-1"].nodes["m1-point-1"].firstExtractionRewards = {
      "probe-heavy-prize": 1,
    };
    let state = createInitialState();
    state.warehouseSlots = 0;
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
      catalog,
    );
    const expeditionId = state.expeditions[0].id;
    state.expeditions[0].phase = "extraction";
    state.expeditions[0].currentNodeId = "m1-point-1";

    expect(() => confirmExtraction(state, expeditionId, 2_000, catalog)).toThrow(
      "仓库放不下",
    );
    expect(state.inventory).toEqual({});
    expect(state.completedExtractionNodeKeys).toEqual([]);
    expect(state.expeditions[0].phase).toBe("extraction");

    // 奖励单重远超宠物负重，但它在撤离结算时发放，所以有仓库格就能领取。
    state.warehouseSlots = 1;
    state = confirmExtraction(state, expeditionId, 3_000, catalog);
    expect(state.inventory).toEqual({ "probe-heavy-prize": 1 });
    expect(state.completedExtractionNodeKeys).toEqual(["map-1:m1-point-1"]);
  });
});

describe("格子与堆叠", () => {
  it("同种物品先堆满一格再占下一格，不同物品不共享格子", () => {
    const catalog = catalogWith({
      "probe-stacked": { stackSize: 20 },
      "probe-single": {},
    });

    expect(inventorySlots({ "probe-stacked": 20 }, catalog)).toBe(1);
    expect(inventorySlots({ "probe-stacked": 21 }, catalog)).toBe(2);
    // probe-single 没配 stackSize，默认一件一格。
    expect(
      inventorySlots({ "probe-stacked": 20, "probe-single": 3 }, catalog),
    ).toBe(4);
    expect(inventorySlots({}, catalog)).toBe(0);
  });

  it("背包超格会阻塞下一步行动，丢弃后立即解除", () => {
    const catalog = catalogWith({ "probe-single": {} });
    let state = arriveMap1();
    const expeditionId = state.expeditions[0].id;
    state = resolveEvent(state, expeditionId, "sort-carefully", 2_000, catalog);

    const slotCapacity = cargoSlotCapacity(state, state.expeditions[0], catalog);
    // 每件占一格，塞到刚好超出上限一格。
    state.expeditions[0].cargo = { "probe-single": slotCapacity + 1 };

    expect(() =>
      chooseRoute(state, expeditionId, "route-2", 3_000, catalog),
    ).toThrow("背包超出 1 格");

    // 阻塞不扣收益，也不改变队伍状态，只是停在原地。
    expect(state.expeditions[0].phase).toBe("awaiting-route");

    state = discardCargo(
      state,
      expeditionId,
      "probe-single",
      1,
      4_000,
      catalog,
    );
    state = chooseRoute(state, expeditionId, "route-2", 5_000, catalog);
    expect(state.expeditions[0].phase).toBe("traveling");
  });

  it("入库按合并后算格子，能堆进已有的堆就不额外占格", () => {
    const catalog = catalogWith({ "probe-stacked": { stackSize: 20 } });

    let state = createInitialState();
    state.warehouseSlots = 1;
    state.inventory = { "probe-stacked": 15 };
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
      catalog,
    );
    const expeditionId = state.expeditions[0].id;
    state.expeditions[0].cargo = { "probe-stacked": 5 };
    state.expeditions[0].phase = "extraction";

    // 15 + 5 = 20，仍然只占 1 格，所以 1 格的仓库放得下。
    state = confirmExtraction(state, expeditionId, 2_000, catalog);
    expect(state.inventory).toEqual({ "probe-stacked": 20 });
  });

  it("撤离整理时可以就地出售，但冒险途中不行", () => {
    let state = arriveMap1();
    const expeditionId = state.expeditions[0].id;
    state = resolveEvent(
      state,
      expeditionId,
      "sort-carefully",
      2_000,
      ruleCatalog,
    );
    state.expeditions[0].cargo = { paper: 3 };

    expect(() =>
      sellCargoItem(state, expeditionId, "paper", 1, 3_000),
    ).toThrow("只有撤离整理时才能出售");

    state = requestExtraction(state, expeditionId, 4_000, ruleCatalog);
    const price = bundledCatalog.items["paper"].sellValue ?? 0;
    state = sellCargoItem(state, expeditionId, "paper", 2, 5_000);
    expect(state.currency).toBe(price * 2);
    expect(state.expeditions[0].cargo).toEqual({ paper: 1 });
  });
});

describe("伤势恢复", () => {
  const HOUR = 60 * 60 * 1_000;

  function hurtAndReturn(stage: "injured" | "incapacitated", now: number) {
    let state = createInitialState();
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      now,
    );
    const expeditionId = state.expeditions[0].id;
    state.pets["gugugaga"].injury = stage;
    state.expeditions[0].phase = "extraction";
    return confirmExtraction(state, expeditionId, now + 1_000);
  }

  it("回到基地才开始计时，途中不会自愈", () => {
    let state = createInitialState();
    state.pets["gugugaga"].injury = "injured";
    state.pets["gugugaga"].injuryRecoveredAt = 5_000;
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
    );

    // 出发即停表。
    expect(state.pets["gugugaga"].injuryRecoveredAt).toBeUndefined();
    const later = tick(state, 1_000 + 10 * HOUR);
    expect(later.pets["gugugaga"].injury).toBe("injured");
  });

  it("撤离后按档位计时，时间到了自动好转一档", () => {
    const state = hurtAndReturn("injured", 1_000);
    expect(state.pets["gugugaga"].injuryRecoveredAt).toBeDefined();

    const tooEarly = tick(state, 2_000 + 29 * 60 * 1_000);
    expect(tooEarly.pets["gugugaga"].injury).toBe("injured");

    const healed = tick(state, 2_000 + 31 * 60 * 1_000);
    expect(healed.pets["gugugaga"].injury).toBe("healthy");
    expect(healed.pets["gugugaga"].injuryRecoveredAt).toBeUndefined();
  });

  it("长时间离线能连着恢复多档", () => {
    const state = hurtAndReturn("incapacitated", 1_000);
    // 失能 4 小时 → 受伤，再 30 分钟 → 正常。
    const partly = tick(state, 2_000 + 4 * HOUR + 1_000);
    expect(partly.pets["gugugaga"].injury).toBe("injured");

    const fully = tick(state, 2_000 + 5 * HOUR);
    expect(fully.pets["gugugaga"].injury).toBe("healthy");
  });

  it("带伤可以再次出勤，只有失能才拦", () => {
    const state = hurtAndReturn("injured", 1_000);
    expect(() =>
      startExpedition(
        state,
        { mapId: "map-1", petIds: ["gugugaga"] },
        3_000,
      ),
    ).not.toThrow();

    const down = structuredClone(state);
    down.pets["gugugaga"].injury = "incapacitated";
    expect(() =>
      startExpedition(
        down,
        { mapId: "map-1", petIds: ["gugugaga"] },
        3_000,
      ),
    ).toThrow("失能");
  });

  it("花钱可以立刻治好，货币不足则拒绝", () => {
    const state = hurtAndReturn("injured", 1_000);
    expect(() => healPet(state, "gugugaga", 3_000)).toThrow("通用货币不足");

    const rich = { ...state, currency: 200 };
    const healed = healPet(rich, "gugugaga", 3_000);
    expect(healed.pets["gugugaga"].injury).toBe("healthy");
    expect(healed.pets["gugugaga"].injuryRecoveredAt).toBeUndefined();
    expect(healed.currency).toBe(0);
  });
});

describe("次要属性", () => {
  const GATED_CHOICE = { stat: "lore" as const, value: 4 };

  function catalogWithChoiceGate(): Catalog {
    const next = catalogWith({});
    next.events["event-shelves"].choices[0].requiredSecondary = GATED_CHOICE;
    return next;
  }

  it("队伍取队内最高值，不叠加", () => {
    let state = createInitialState();
    state = withSecondary(state, "gugugaga", { courage: 3 });
    state.pets["helper"] = {
      ...structuredClone(state.pets["gugugaga"]),
      id: "helper",
      name: "Helper",
      secondaryStats: { eloquence: 0, lore: 0, courage: 5, guile: 0 },
    };

    // 3 和 5 取最高得 5，而不是相加得 8。
    expect(teamSecondaryStat(state, ["gugugaga", "helper"], "courage")).toBe(5);
    expect(teamSecondaryStat(state, ["gugugaga"], "courage")).toBe(3);
    expect(teamSecondaryStat(state, [], "courage")).toBe(0);
  });

  it("不受伤势影响", () => {
    let state = createInitialState();
    state = withSecondary(state, "gugugaga", { courage: 5 });
    const healthy = teamSecondaryStat(state, ["gugugaga"], "courage");

    // 主属性会乘伤势倍率，次要属性刻意不乘：硬门槛在一轮内跳变无法解释。
    state.pets["gugugaga"].injury = "injured";
    expect(teamSecondaryStat(state, ["gugugaga"], "courage")).toBe(healthy);
  });

  it("受伤成员保留完整次要属性，失能成员不参与计算", () => {
    let state = createInitialState();
    state = withSecondary(state, "gugugaga", { courage: 3 });
    state.pets.helper = {
      ...structuredClone(state.pets.gugugaga),
      id: "helper",
      name: "Helper",
      injury: "injured",
      secondaryStats: { eloquence: 0, lore: 0, courage: 5, guile: 0 },
    };

    expect(teamSecondaryStat(state, ["gugugaga", "helper"], "courage")).toBe(5);
    state.pets.helper.injury = "incapacitated";
    expect(teamSecondaryStat(state, ["gugugaga", "helper"], "courage")).toBe(3);
  });

  it("达到次要属性基础门槛后必定成功，且不消耗随机骰", () => {
    const catalog = catalogWith({});
    catalog.events["event-shelves"].choices = [
      {
        id: "read-mark",
        label: "辨认暗记",
        description: "依靠学识直接判断。",
        resolution: {
          type: "secondary",
          stat: "lore",
          successThreshold: 3,
          extraSuccessThreshold: 5,
        },
        rewards: { paper: 1 },
        bonusRewards: { screw: 1 },
      },
    ];
    let state = arriveMap1(1_000, catalog);
    state = withSecondary(state, "gugugaga", { lore: 3 });
    state.expeditions[0].currentEventId = "event-shelves";
    const seedBefore = state.expeditions[0].currentSeed;

    state = resolveEvent(
      state,
      state.expeditions[0].id,
      "read-mark",
      2_000,
      catalog,
    );

    expect(state.expeditions[0].lastResolution?.outcome).toBe("success");
    expect(state.expeditions[0].lastResolution?.reward).toEqual({ paper: 1 });
    expect(state.expeditions[0].currentSeed).toBe(seedBefore);
    expect(state.pets.gugugaga.injury).toBe("healthy");
  });

  it("次要属性不足时不可选择，达到更高门槛后必定大成功", () => {
    const catalog = catalogWith({});
    catalog.events["event-shelves"].choices = [
      {
        id: "read-mark",
        label: "辨认暗记",
        description: "依靠学识直接判断。",
        resolution: {
          type: "secondary",
          stat: "lore",
          successThreshold: 3,
          extraSuccessThreshold: 5,
        },
        rewards: { paper: 1 },
        bonusRewards: { screw: 1 },
      },
    ];
    let state = arriveMap1(1_000, catalog);
    state.expeditions[0].currentEventId = "event-shelves";
    state = withSecondary(state, "gugugaga", { lore: 2 });
    const choice = catalog.events["event-shelves"].choices[0];

    catalog.maps["map-1"].informationThresholds = { partial: 3, full: 4 };
    expect(
      getRiskPreview(
        state,
        state.expeditions[0].id,
        choice.id,
        catalog,
      ),
    ).toMatchObject({
      label: "学识不足",
      detail: "",
    });

    catalog.maps["map-1"].informationThresholds = { partial: 2, full: 4 };
    expect(
      getRiskPreview(
        state,
        state.expeditions[0].id,
        choice.id,
        catalog,
      ),
    ).toMatchObject({
      label: "需要学识达到 3",
      detail: "",
    });

    state.pets.gugugaga.allocatedStats.perception = 2;
    expect(
      getRiskPreview(
        state,
        state.expeditions[0].id,
        choice.id,
        catalog,
      ),
    ).toMatchObject({
      label: "成功条件 · 学识达到 3",
      detail: "大成功条件 · 学识达到 5",
    });
    state.pets.gugugaga.allocatedStats.perception = 0;

    expect(
      isChoiceAvailable(state, state.expeditions[0], choice),
    ).toEqual({ available: false, reason: "需要学识 3（当前 2）" });
    expect(() =>
      resolveEvent(
        state,
        state.expeditions[0].id,
        choice.id,
        2_000,
        catalog,
      ),
    ).toThrow("需要学识 3（当前 2）");

    state = withSecondary(state, "gugugaga", { lore: 5 });
    catalog.maps["map-1"].informationThresholds = { partial: 3, full: 4 };
    expect(
      getRiskPreview(
        state,
        state.expeditions[0].id,
        choice.id,
        catalog,
      ),
    ).toMatchObject({
      label: "",
      detail: "",
    });
    catalog.maps["map-1"].informationThresholds = { partial: 2, full: 4 };
    expect(
      getRiskPreview(
        state,
        state.expeditions[0].id,
        choice.id,
        catalog,
      ),
    ).toMatchObject({ label: "", detail: "" });
    state.pets.gugugaga.allocatedStats.perception = 2;
    expect(
      getRiskPreview(
        state,
        state.expeditions[0].id,
        choice.id,
        catalog,
      ),
    ).toMatchObject({
      label: "成功条件 · 学识达到 3",
      detail: "大成功条件 · 学识达到 5",
    });
    state = resolveEvent(
      state,
      state.expeditions[0].id,
      choice.id,
      2_000,
      catalog,
    );
    expect(state.expeditions[0].lastResolution?.outcome).toBe("extra-success");
    expect(state.expeditions[0].lastResolution?.reward).toEqual({
      paper: 1,
      screw: 1,
    });
    expect(state.pets.gugugaga.injury).toBe("healthy");
  });

  it("直接离开不掷骰、不改变队伍与背包，并结束当前事件", () => {
    const catalog = catalogWith({});
    catalog.events["event-shelves"].choices = [
      {
        id: "leave",
        label: "默默离开",
        description: "不去碰来历不明的东西。",
        resolution: { type: "leave" },
        requiredTagId: "missing-tag-that-must-not-lock-leaving",
        rewards: {},
      },
    ];
    let state = arriveMap1(1_000, catalog);
    state.expeditions[0].currentEventId = "event-shelves";
    const seedBefore = state.expeditions[0].currentSeed;
    const cargoBefore = structuredClone(state.expeditions[0].cargo);
    expect(
      isChoiceAvailable(
        state,
        state.expeditions[0],
        catalog.events["event-shelves"].choices[0],
      ),
    ).toEqual({ available: true });

    state = resolveEvent(
      state,
      state.expeditions[0].id,
      "leave",
      2_000,
      catalog,
    );

    expect(state.expeditions[0].lastResolution?.outcome).toBe("leave");
    expect(state.expeditions[0].lastResolution?.reward).toEqual({});
    expect(state.expeditions[0].currentSeed).toBe(seedBefore);
    expect(state.expeditions[0].cargo).toEqual(cargoBefore);
    expect(state.pets.gugugaga.injury).toBe("healthy");
    expect(state.expeditions[0].phase).toBe("awaiting-route");
  });

  it("选项门禁由规则层返回完整差值，达标后可选", () => {
    const catalog = catalogWithChoiceGate();
    let state = createInitialState();
    state = withSecondary(state, "gugugaga", { lore: 2 });
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
      catalog,
    );
    state = tick(state, state.expeditions[0].arriveAt, catalog);
    state = chooseRoute(
      state,
      state.expeditions[0].id,
      "route-1",
      state.expeditions[0].arriveAt,
      catalog,
    );
    state = tick(state, state.expeditions[0].arriveAt, catalog);
    state.expeditions[0].currentEventId = "event-shelves";

    const blocked = isChoiceAvailable(
      state,
      state.expeditions[0],
      catalog.events["event-shelves"].choices[0],
    );
    expect(blocked.available).toBe(false);
    // 规则层保留完整差值；展示层会在第一档情报中遮掉数字。
    expect(blocked.reason).toBe("需要学识 4（当前 2）");

    const ready = withSecondary(state, "gugugaga", { lore: 4 });
    expect(
      isChoiceAvailable(
        ready,
        ready.expeditions[0],
        catalog.events["event-shelves"].choices[0],
      ).available,
    ).toBe(true);
  });

  it("路线不达标时置灰并标明还差多少", () => {
    const catalog = catalogWith({});
    catalog.maps["map-1"].nodes["m1-point-1"].edges[0].requirement = {
      secondary: { stat: "eloquence", value: 4 },
    };
    let state = createInitialState();
    state = withSecondary(state, "gugugaga", { eloquence: 2 });
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
      catalog,
    );
    state = tick(state, state.expeditions[0].arriveAt, catalog);
    const expeditionId = state.expeditions[0].id;
    state = chooseRoute(
      state,
      expeditionId,
      "route-1",
      state.expeditions[0].arriveAt,
      catalog,
    );
    state = tick(state, state.expeditions[0].arriveAt, catalog);
    state = pickupAllNodeLoot(state, state.expeditions[0].id, 2_000, catalog);
    state = finishNodeLoot(state, state.expeditions[0].id, true, 2_000);
    state = resolveEvent(
      state,
      expeditionId,
      "sort-carefully",
      2_000,
      catalog,
    );

    const blocked = getRouteAvailability(
      state,
      expeditionId,
      "route-2",
      catalog,
    );
    expect(blocked.available).toBe(false);
    expect(blocked.reason).toBe("需要口才 4（当前 2）");
    expect(() =>
      chooseRoute(state, expeditionId, "route-2", 3_000, catalog),
    ).toThrow("需要口才 4");

    const ready = withSecondary(state, "gugugaga", { eloquence: 4 });
    expect(
      getRouteAvailability(ready, expeditionId, "route-2", catalog).available,
    ).toBe(true);
  });

  it("隐藏路线在缺少 Tag 时完全不可见，获得 Tag 后显现并可通行", () => {
    const catalog = structuredClone(bundledCatalog);
    const hiddenRoute = catalog.maps["map-1"].nodes["m1-start"].edges[0];
    hiddenRoute.hidden = true;
    hiddenRoute.requirement = { tagId: "tag-lucky" };

    let state = createInitialState();
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
      catalog,
    );
    state = tick(state, state.expeditions[0].arriveAt, catalog);
    const expeditionId = state.expeditions[0].id;

    expect(
      getVisibleRoutes(state, expeditionId, catalog).map((edge) => edge.id),
    ).not.toContain(hiddenRoute.id);
    expect(
      getRouteAvailability(state, expeditionId, hiddenRoute.id, catalog),
    ).toEqual({ available: false, reason: "需要 Tag「幸运儿」" });
    expect(() =>
      chooseRoute(state, expeditionId, hiddenRoute.id, 2_000, catalog),
    ).toThrow("需要 Tag「幸运儿」");

    state.pets.gugugaga.growthTagIds.push("tag-lucky");
    expect(
      getVisibleRoutes(state, expeditionId, catalog).map((edge) => edge.id),
    ).toContain(hiddenRoute.id);
    expect(
      getRouteAvailability(state, expeditionId, hiddenRoute.id, catalog),
    ).toEqual({ available: true });
    state = chooseRoute(state, expeditionId, hiddenRoute.id, 3_000, catalog);
    expect(state.expeditions[0].targetNodeId).toBe(hiddenRoute.toNodeId);
    expect(state.discoveredRouteKeys).toEqual([]);

    state = tick(state, state.expeditions[0].arriveAt, catalog);
    expect(state.discoveredRouteKeys).toContain(
      `map-1:m1-start:${hiddenRoute.id}`,
    );

    state.pets.gugugaga.growthTagIds = [];
    state.expeditions[0].phase = "awaiting-route";
    state.expeditions[0].currentNodeId = "m1-start";
    expect(
      getVisibleRoutes(state, expeditionId, catalog).map((edge) => edge.id),
    ).toContain(hiddenRoute.id);
    expect(
      getRouteAvailability(state, expeditionId, hiddenRoute.id, catalog),
    ).toEqual({ available: false, reason: "需要 Tag「幸运儿」" });
  });

  it("按当前队伍有效感知与地图阈值即时计算三档情报", () => {
    const catalog = structuredClone(bundledCatalog);
    catalog.maps["map-1"].informationThresholds = { partial: 2, full: 4 };
    const state = createInitialState();
    expect(mapInformationTier(state, "map-1", [], catalog)).toBe(1);
    expect(teamStatForPets(state, ["gugugaga"], "perception")).toBe(2);
    expect(mapInformationTier(state, "map-1", ["gugugaga"], catalog)).toBe(2);
    state.pets.gugugaga.allocatedStats.perception = 2;
    expect(mapInformationTier(state, "map-1", ["gugugaga"], catalog)).toBe(3);
  });

  it("最高稀有度只读取节点基础掉落且尊重候选池", () => {
    const catalog = structuredClone(bundledCatalog);
    const loot = structuredClone(catalog.maps["map-1"].nodes["m1-point-1"].loot)!;
    expect(loot.mode).toBe("independent");
    if (loot.mode !== "independent") throw new Error("fixture must use independent loot");
    loot.rarityWeights.mythic = 99;
    loot.blacklistItemIds = Object.values(catalog.items)
      .filter((item) => item.rarity === "mythic")
      .map((item) => item.id);
    expect(nodeLootMaximumRarity(loot, catalog)).not.toBe("mythic");
    expect(nodeLootMaximumRarity(loot, catalog)).toBe("epic");
  });

  it("主属性硬门槛也要标明数值，不能丢英文字段名给玩家", () => {
    const catalog = structuredClone(bundledCatalog);
    catalog.maps["map-1"].nodes["m1-point-1"].edges[0].requirement = {
      minimumStat: { fitness: 9 },
    };
    let state = createInitialState();
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
      catalog,
    );
    // 不处理事件：事件可能让宠物受伤，而主属性会跟着伤势打折，
    // 那样这条断言测的就不是文案格式了。
    state = tick(state, state.expeditions[0].arriveAt, catalog);
    state.expeditions[0].currentNodeId = "m1-point-1";

    const blocked = getRouteAvailability(
      state,
      state.expeditions[0].id,
      "route-2",
      catalog,
    );
    expect(blocked.reason).toBe("需要体能 9（当前 2）");
  });

  it("门禁不达标的事件不参与抽取，并在节点信息里列出来", () => {
    let state = createInitialState();
    state = withSecondary(state, "gugugaga", { courage: 1 });

    const locked = lockedNodeEvents(
      state,
      {
        mapId: "map-1",
        nodeId: "m1-point-1",
        petIds: ["gugugaga"],
      },
      ruleCatalog,
    );
    expect(locked).toHaveLength(1);
    expect(locked[0].eventId).toBe("event-vent");
    expect(locked[0].gate.label).toBe("需要勇气 4（当前 1）");

    // 勇气不足时反复抽取只会抽到没有门禁的那个事件。
    for (let seed = 1; seed < 40; seed += 1) {
      let probe = startExpedition(
        state,
        { mapId: "map-1", petIds: ["gugugaga"] },
        seed * 1_000,
        ruleCatalog,
      );
      probe.expeditions[0].currentSeed = seed;
      probe = tick(probe, probe.expeditions[0].arriveAt, ruleCatalog);
      probe = chooseRoute(
        probe,
        probe.expeditions[0].id,
        "route-1",
        probe.expeditions[0].arriveAt,
        ruleCatalog,
      );
      probe = tick(probe, probe.expeditions[0].arriveAt, ruleCatalog);
      expect(probe.expeditions[0].currentEventId).toBe("event-shelves");
    }

    // 达标后它重新进入事件池，清单也随之清空。
    const brave = withSecondary(state, "gugugaga", { courage: 4 });
    expect(
      lockedNodeEvents(
        brave,
        {
          mapId: "map-1",
          nodeId: "m1-point-1",
          petIds: ["gugugaga"],
        },
        ruleCatalog,
      ),
    ).toHaveLength(0);
  });

  it("成长道具按显式字段加点，不看稀有度，且封顶", () => {
    const cap = secondaryStatCap();
    const catalog = catalogWith({
      "probe-book": { rarity: "common", secondaryGrant: { stat: "lore", amount: 3 } },
      "probe-plain": { rarity: "legendary" },
    });

    let state = createInitialState();
    state = withSecondary(state, "gugugaga", { lore: 1 });
    state.inventory = { "probe-book": 2, "probe-plain": 1 };

    // 白档也能给 +3：加成来自 secondaryGrant，与稀有度无关。
    state = applySecondaryGrantItem(state, "gugugaga", "probe-book", 1_000, catalog);
    expect(state.pets["gugugaga"].secondaryStats.lore).toBe(4);
    expect(state.inventory["probe-book"]).toBe(1);

    // 传说档没有 secondaryGrant 就不是成长道具。
    expect(() =>
      applySecondaryGrantItem(state, "gugugaga", "probe-plain", 2_000, catalog),
    ).toThrow("无法使用该成长道具");

    // 封顶：到达上限后拒绝使用，道具不被消耗。
    let capped = withSecondary(state, "gugugaga", { lore: cap });
    expect(() =>
      applySecondaryGrantItem(capped, "gugugaga", "probe-book", 3_000, catalog),
    ).toThrow("已经达到上限");
    expect(capped.inventory["probe-book"]).toBe(1);

    // 溢出被截断到上限，不会超过。
    capped = withSecondary(state, "gugugaga", { lore: cap - 1 });
    capped = applySecondaryGrantItem(capped, "gugugaga", "probe-book", 4_000, catalog);
    expect(capped.pets["gugugaga"].secondaryStats.lore).toBe(cap);
  });

  it("次要属性不消耗属性点", () => {
    let state = createInitialState();
    state.pets["gugugaga"].unspentPoints = 5;
    const before = structuredClone(state.pets["gugugaga"].secondaryStats);

    state = allocateStat(state, "gugugaga", "technique");

    expect(state.pets["gugugaga"].unspentPoints).toBe(4);
    expect(state.pets["gugugaga"].secondaryStats).toEqual(before);
  });
});

describe("背包格子来自技巧", () => {
  it("加技巧当场增加格子上限", () => {
    let state = createInitialState();
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
    );
    const before = cargoSlotCapacity(state, state.expeditions[0]);

    state.pets["gugugaga"].allocatedStats.technique += 2;
    const after = cargoSlotCapacity(state, state.expeditions[0]);

    expect(after).toBeGreaterThan(before);
  });

  it("格子不受伤势影响，负重受影响", () => {
    let state = createInitialState();
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
    );
    const slots = cargoSlotCapacity(state, state.expeditions[0]);
    const carry = cargoCapacity(state, state.expeditions[0]);

    state.pets["gugugaga"].injury = "injured";

    // 受伤的宠物背不动那么重，但包还是那么大。
    expect(cargoSlotCapacity(state, state.expeditions[0])).toBe(slots);
    expect(cargoCapacity(state, state.expeditions[0])).toBeLessThan(carry);
  });
});

describe("等级与经验", () => {
  it("升级需求走 等级^1.4 × 20，满级后停止累计", () => {
    expect(maxLevel()).toBe(20);
    expect(xpToNextLevel(1)).toBe(20);
    expect(xpToNextLevel(2)).toBe(53);
    expect(xpToNextLevel(19)).toBe(1234);
    // 满级后没有「下一级」。
    expect(xpToNextLevel(20)).toBe(0);

    // 曲线必须严格递增，否则高等级会比低等级更好升。
    for (let lv = 1; lv < 19; lv += 1) {
      expect(xpToNextLevel(lv + 1)).toBeGreaterThan(xpToNextLevel(lv));
    }
  });

  it("等级封顶后不再涨级，也不囤积用不掉的经验", () => {
    let state = createInitialState();
    state.pets["gugugaga"].level = maxLevel();
    state.pets["gugugaga"].xp = 0;
    const before = state.pets["gugugaga"].unspentPoints;

    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
    );
    const expeditionId = state.expeditions[0].id;
    state.expeditions[0].completedNodeCount = 3;
    state.expeditions[0].phase = "extraction";
    state = confirmExtraction(state, expeditionId, 2_000);

    expect(state.pets["gugugaga"].level).toBe(maxLevel());
    expect(state.pets["gugugaga"].xp).toBe(0);
    expect(state.pets["gugugaga"].unspentPoints).toBe(before);
  });

  it("战利品按稀有度给经验，白绿为 0，按件数累加", () => {
    const catalog = catalogWith({
      "probe-common": { rarity: "common" },
      "probe-uncommon": { rarity: "uncommon" },
      "probe-rare": { rarity: "rare" },
      "probe-epic": { rarity: "epic" },
      "probe-legendary": { rarity: "legendary" },
      "probe-mythic": { rarity: "mythic" },
    });

    expect(lootXp({ "probe-common": 99 }, catalog)).toBe(0);
    expect(lootXp({ "probe-uncommon": 99 }, catalog)).toBe(0);
    expect(lootXp({ "probe-rare": 1 }, catalog)).toBe(2);
    // 按件数，不是按种类。
    expect(lootXp({ "probe-rare": 3 }, catalog)).toBe(6);
    expect(lootXp({ "probe-epic": 2 }, catalog)).toBe(16);
    expect(lootXp({ "probe-legendary": 1 }, catalog)).toBe(30);
    expect(lootXp({ "probe-mythic": 1 }, catalog)).toBe(100);
    expect(
      lootXp({ "probe-rare": 1, "probe-epic": 1, "probe-common": 5 }, catalog),
    ).toBe(10);
  });

  it("地图经验系数同时乘在节点经验和战利品经验上", () => {
    const catalog = catalogWith({ "probe-epic": { rarity: "epic" } });
    catalog.maps["map-1"].xpMultiplier = 3;
    expect(mapXpMultiplier("map-1", catalog)).toBe(3);

    let state = createInitialState();
    state = startExpedition(
      state,
      { mapId: "map-1", petIds: ["gugugaga"] },
      1_000,
      catalog,
    );
    const expeditionId = state.expeditions[0].id;
    state.expeditions[0].completedNodeCount = 2;
    state.expeditions[0].cargo = { "probe-epic": 1 };
    state.expeditions[0].phase = "extraction";

    state = confirmExtraction(state, expeditionId, 2_000, catalog);

    // (2 节点 × 10 + 史诗 8) × 3 = 84
    expect(state.settlements[0].xpAward).toBe(84);
  });

  it("撤离时卖掉的战利品照样算经验，丢弃的不算", () => {
    const catalog = catalogWith({
      "probe-epic": { rarity: "epic", sellValue: 100 },
    });

    function run(action: "keep" | "sell" | "discard") {
      let state = createInitialState();
      state = startExpedition(
        state,
        { mapId: "map-1", petIds: ["gugugaga"] },
        1_000,
        catalog,
      );
      const id = state.expeditions[0].id;
      state.expeditions[0].completedNodeCount = 1;
      state.expeditions[0].cargo = { "probe-epic": 2 };
      state.expeditions[0].phase = "extraction";
      if (action === "sell") {
        state = sellCargoItem(state, id, "probe-epic", 2, 2_000, catalog);
      } else if (action === "discard") {
        state = discardCargo(state, id, "probe-epic", 2, 2_000, catalog);
      }
      return confirmExtraction(state, id, 3_000, catalog).settlements[0].xpAward;
    }

    // 1 节点 × 10 + 史诗 ×2 = 26
    expect(run("keep")).toBe(26);
    expect(run("sell")).toBe(26);
    // 丢掉的不算，只剩节点经验。
    expect(run("discard")).toBe(10);
  });

  it("溃败只给节点经验的一半，没有战利品经验", () => {
    const catalog = catalogWith({ "probe-epic": { rarity: "epic" } });
    const base = createInitialState();
    base.pets.gugugaga.injury = "injured";
    const started = startExpedition(
      base,
      { mapId: "map-1", petIds: ["gugugaga"] },
      10_000,
      catalog,
    );

    let defeated: GameState | undefined;
    for (let seed = 1; seed < 500 && !defeated; seed += 1) {
      const candidate = structuredClone(started);
      candidate.expeditions[0].phase = "awaiting-event";
      candidate.expeditions[0].currentNodeId = "m1-goal-1";
      candidate.expeditions[0].currentEventId = "event-backroom";
      candidate.expeditions[0].currentSeed = seed;
      candidate.expeditions[0].completedNodeCount = 4;
      candidate.expeditions[0].cargo = { "probe-epic": 5 };
      const result = resolveEvent(
        candidate,
        candidate.expeditions[0].id,
        "pry-lock",
        11_000,
        catalog,
      );
      if (result.settlements[0]?.outcome === "defeat") defeated = result;
    }

    expect(defeated).toBeDefined();
    // 4 节点 × 10 × 0.5 = 20，背包里那 5 件史诗一点经验都不给。
    expect(defeated!.settlements[0].xpAward).toBe(20);
  });
});
