import { afterEach, describe, expect, it, vi } from "vitest";
import { bundledCatalog, setCatalog } from "./catalog";
import { createInitialState, startExpedition, tick, resolveEvent, isChoiceAvailable, taskCanComplete, finishNodeLoot } from "./engine";
import { validateCatalog, initializeCatalog, loadCatalogDraft } from "../config/catalogStore";
import { loadGame, saveGame } from "../persistence/storage";
import type { Catalog } from "./types";

function setup(catalog: Catalog = structuredClone(bundledCatalog)) {
  let state = createInitialState();
  state.unlockedMapIds.push("map-3");
  state.inventory.orange = 2;
  const petId = Object.keys(state.pets)[0];
  state = startExpedition(state, { mapId: "map-3", petIds: [petId], cargo: { orange: 1 } }, 0, catalog);
  // 到达目标前的远征快照；路线本身由 yuwanMap.test 完整遍历。
  state.expeditions[0].targetNodeId = "m3-d2";
  state = tick(state, state.expeditions[0].arriveAt, catalog);
  // 正式节点已有掉落：先结束拾取，再测试交付，不把随机掉落混入断言。
  if (state.expeditions[0].pendingLoot !== undefined) {
    state = finishNodeLoot(state, state.expeditions[0].id, true, 1);
  }
  return { state, catalog, id: state.expeditions[0].id };
}
afterEach(() => { vi.unstubAllGlobals(); setCatalog(bundledCatalog); });

describe("固定事件现场交付", () => {
  it("内置内容及关联引用通过配置校验", () => {
    expect(validateCatalog(bundledCatalog).filter(i => i.level === "error")).toEqual([]);
  });
  it("无视任务前置与未携带物品，抵达必定出现；缺物品只能离开", () => {
    const { state, catalog, id } = setup();
    catalog.tasks["recruit-doro"].prerequisiteTaskIds = ["tasks-pass-map-2"];
    state.expeditions[0].cargo = {};
    expect(state.expeditions[0].currentEventId).toBe("doro-encounter");
    expect(() => resolveEvent(state, id, "give-orange", 1, catalog)).toThrow("探险背包");
    expect(state.inventory.orange).toBe(1);
    const left = resolveEvent(state, id, "leave", 1, catalog);
    expect(left.pets.doro).toBeUndefined();
    expect(left.expeditions[0].phase).toBe("awaiting-route");
  });
  it("锁定拒绝交付；解锁后原子扣背包、清初始来源、立刻发宠物且不加入远征", () => {
    const { state, catalog, id } = setup();
    catalog.tasks["recruit-doro"].prerequisiteTaskIds = ["tasks-pass-map-2"];
    state.lockedItemIds = ["orange"];
    expect(isChoiceAvailable(state, state.expeditions[0], catalog.events["doro-encounter"].choices[0], catalog).reason).toContain("锁定");
    expect(() => resolveEvent(state, id, "give-orange", 1, catalog)).toThrow("锁定");
    state.lockedItemIds = [];
    const seed = state.expeditions[0].currentSeed;
    const next = resolveEvent(state, id, "give-orange", 1, catalog);
    expect(next.pets.doro).toEqual(catalog.petTemplates.doro);
    expect(next.expeditions[0].petIds).toEqual(state.expeditions[0].petIds);
    expect(next.expeditions[0].cargo).toEqual({});
    expect(next.expeditions[0].initialCargo).toEqual({});
    expect(next.expeditions[0].currentSeed).toBe(seed);
    expect(next.expeditions[0].lastResolution?.check).toEqual({ type: "delivery" });
    expect(next.inventory.orange).toBe(1);
    expect(next.completedTaskIds).toContain("recruit-doro");
    expect(next.completedEventChoiceKeys).toContain(JSON.stringify(["doro-encounter", "give-orange"]));
    expect(taskCanComplete(next, "recruit-doro", catalog)).toBe(false);
    expect(state.pets.doro).toBeUndefined();
    expect(state.expeditions[0].cargo.orange).toBe(1);
    expect(() => resolveEvent(next, id, "give-orange", 2, catalog)).toThrow();
  });
  it("另一队伍的旧交付按钮不能重复扣物品，仍可离开", () => {
    const { state, catalog, id } = setup();
    const second = structuredClone(state.expeditions[0]);
    second.id = "second";
    state.expeditions.push(second);
    const next = resolveEvent(state, id, "give-orange", 1, catalog);
    expect(() => resolveEvent(next, "second", "give-orange", 2, catalog)).toThrow("已经完成");
    expect(next.expeditions[1].cargo.orange).toBe(1);
    expect(resolveEvent(next, "second", "leave", 2, catalog).expeditions[1].phase).toBe("awaiting-route");
  });
  it("固定事件优先替换随机池；获得宠物后恢复普通池", () => {
    const catalog = structuredClone(bundledCatalog);
    const ordinary = Object.keys(catalog.events).find(id => id !== "doro-encounter")!;
    catalog.events[ordinary].requiredSecondary = undefined;
    catalog.eventPools.test = { id: "test", eventIds: [ordinary] };
    catalog.maps["map-3"].nodes["m3-d2"].eventPoolIds = ["test"];
    const { state } = setup(catalog);
    expect(state.expeditions[0].currentEventId).toBe("doro-encounter");
    state.pets.doro = structuredClone(catalog.petTemplates.doro);
    state.expeditions[0].phase = "traveling";
    expect(tick(state, state.expeditions[0].arriveAt, catalog).expeditions[0].currentEventId).toBe(ordinary);
    catalog.maps["map-3"].nodes["m3-d2"].eventPoolIds = [];
    expect(tick(state, state.expeditions[0].arriveAt, catalog).expeditions[0].phase).toBe("awaiting-route");
  });
  it("交付奖励放不下时不扣物品，不写进度", () => {
    const { state, catalog, id } = setup();
    state.warehouseSlots = 0;
    catalog.tasks["recruit-doro"].reward.items = { orange: 100 };
    expect(() => resolveEvent(state, id, "give-orange", 1, catalog)).toThrow("入库空间");
    expect(state.expeditions[0].cargo.orange).toBe(1);
    expect(state.completedEventChoiceKeys).toEqual([]);
  });
  it("招募后遭遇溃败不回收宠物或任务奖励，存读档保留记录", () => {
    const { state, catalog, id } = setup();
    let next = resolveEvent(state, id, "give-orange", 1, catalog);
    catalog.events.disaster = { id: "disaster", title: "测试危险", description: "", choices: [{ id: "risk", label: "迎战", description: "", resolution: { type: "primary", stat: "fitness", difficulty: 100 }, rewards: {} }] };
    next.pets[next.expeditions[0].petIds[0]].injury = "injured";
    next.expeditions[0].phase = "awaiting-event";
    next.expeditions[0].currentEventId = "disaster";
    next = resolveEvent(next, id, "risk", 2, catalog);
    expect(next.settlements.at(-1)?.outcome).toBe("defeat");
    expect(next.pets.doro).toBeDefined();
    expect(next.completedTaskIds).toContain("recruit-doro");
    let raw = "";
    vi.stubGlobal("localStorage", { getItem: () => raw, setItem: (_: string, value: string) => { raw = value; } });
    saveGame(next);
    expect(loadGame().completedEventChoiceKeys).toEqual(next.completedEventChoiceKeys);
    expect(loadGame().pets.doro).toEqual(next.pets.doro);
    const legacy = createInitialState(); delete legacy.completedEventChoiceKeys;
    raw = JSON.stringify(legacy);
    expect(loadGame().completedEventChoiceKeys).toEqual([]);
  });
  it.each(["draft", "published"])("旧%s增量补内容且保留地图修改，之后不强行恢复已删除配置", source => {
    const old = structuredClone(bundledCatalog);
    delete old.events["doro-encounter"]; delete old.tasks["recruit-doro"]; delete old.petTemplates.doro;
    delete old.maps["map-3"].nodes["m3-d2"].fixedEventIds;
    old.maps["map-3"].nodes["m3-d2"].name = "手动改名";
    const key = `idle-pet-adventure.catalog.${source}.v6`;
    const store = new Map([[key, JSON.stringify(old)]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, value: string) => store.set(k, value) });
    const load = () => source === "draft" ? loadCatalogDraft().catalog : initializeCatalog();
    const next = load();
    expect(next.events["doro-encounter"]).toBeDefined();
    expect(next.maps["map-3"].nodes["m3-d2"].name).toBe("手动改名");
    expect(next.maps["map-3"].nodes["m3-d2"].fixedEventIds).toEqual(["doro-encounter"]);
    store.set(key, JSON.stringify(old));
    expect(load().events["doro-encounter"]).toBeUndefined();
  });
  it("拒绝坏引用、无交付物、未关联任务目标、起点固定事件", () => {
    const c = structuredClone(bundledCatalog);
    c.events["doro-encounter"].absentPetIds = ["missing"];
    c.events["doro-encounter"].choices[0].resolution = { type: "delivery", items: {}, completeTaskId: "missing" };
    c.maps["map-3"].nodes["m3-s1"].fixedEventIds = ["doro-encounter"];
    const errors = validateCatalog(c).filter(i => i.level === "error");
    expect(errors.some(i => i.path.includes("absentPetIds"))).toBe(true);
    expect(errors.some(i => i.message.includes("至少一种"))).toBe(true);
    expect(errors.some(i => i.message.includes("关联任务"))).toBe(true);
    expect(errors.some(i => i.path.includes("fixedEventIds"))).toBe(true);
    expect(errors.some(i => i.path.includes("requirement.goals"))).toBe(true);
  });
});
