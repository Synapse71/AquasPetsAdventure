import { catalog } from "../domain/catalog";
import { createGachaState, createInitialState } from "../domain/engine";
import type { GameState } from "../domain/types";

// 不兼容的版本仍会重开；同版本新增的可选字段在这里做轻量补全，
// 避免 Demo 迭代时因为一个数组字段让现有存档失效。
const STORAGE_KEY = "idle-pet-adventure.demo.v1";
const SUPPORTED_VERSION = 10;
const VERSION_WITH_SIMPLIFIED_INJURY = 8;
const VERSION_WITH_ACQUISITION_COUNTS = 9;

function migrateVersion7(parsed: GameState): GameState {
  const next = structuredClone(parsed);
  next.version = VERSION_WITH_SIMPLIFIED_INJURY;
  for (const pet of Object.values(next.pets)) {
    // v7 的“重伤”并入 v8 的“受伤”，失能状态保持不变。
    if ((pet.injury as string) === "critical") pet.injury = "injured";
  }
  for (const expedition of next.expeditions ?? []) {
    const resolution = expedition.lastResolution;
    if (!resolution) continue;
    const legacyOutcome = resolution.outcome as string;
    if (legacyOutcome === "costly-success") resolution.outcome = "success";
    if (legacyOutcome === "severe-failure") resolution.outcome = "big-failure";
  }
  return next;
}

function migrateVersion8(parsed: GameState): GameState {
  const next = structuredClone(parsed);
  next.version = VERSION_WITH_ACQUISITION_COUNTS;

  // 旧存档只记“是否见过”，无法还原已经出售或消耗的精确历史次数。
  // 用现有仓库与正在冒险中新增的物品建立可信下限，同时保证每个旧解锁至少为 1。
  const counts = { ...(next.itemAcquisitionCounts ?? {}) };
  for (const itemId of next.discoveredItemIds ?? []) {
    let knownHeld = next.inventory?.[itemId] ?? 0;
    for (const expedition of next.expeditions ?? []) {
      const cargo = expedition.cargo?.[itemId] ?? 0;
      const initial = expedition.initialCargo?.[itemId] ?? 0;
      knownHeld += Math.max(0, cargo - initial);
    }
    counts[itemId] = Math.max(counts[itemId] ?? 0, knownHeld, 1);
  }
  next.itemAcquisitionCounts = counts;
  return next;
}

function migrateVersion9(parsed: GameState): GameState {
  const next = structuredClone(parsed);
  next.version = SUPPORTED_VERSION;

  // v9 只记「哪些撤离点撤离过」，撤离过就当首次奖励已领。v10 改记「每个撤离点领过什么」。
  // 旧记录按当前配置换算：配置里的奖励物品，玩家得到过就算领过；从没得到过，说明是通关之后才加的
  // （例如北山驿站的「卡牌：白鼬」），留给读档后的补发。
  const counts = next.itemAcquisitionCounts ?? {};
  const claimed: Record<string, GameState["inventory"]> = {};
  for (const key of next.completedExtractionNodeKeys ?? []) {
    const [mapId, nodeId] = key.split(":");
    const rewards = catalog.maps[mapId]?.nodes[nodeId]?.firstExtractionRewards ?? {};
    const owned = Object.fromEntries(Object.entries(rewards).filter(([itemId]) => (counts[itemId] ?? 0) > 0));
    if (Object.keys(owned).length) claimed[key] = owned;
  }
  next.claimedExtractionRewards = claimed;
  return next;
}

export function loadGame(): GameState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    let parsed = JSON.parse(raw) as GameState;
    if (parsed.version === 7) parsed = migrateVersion7(parsed);
    if (parsed.version === VERSION_WITH_SIMPLIFIED_INJURY) {
      parsed = migrateVersion8(parsed);
    }
    if (parsed.version === VERSION_WITH_ACQUISITION_COUNTS) parsed = migrateVersion9(parsed);
    if (parsed.version !== SUPPORTED_VERSION) return createInitialState();
    if (import.meta.env.DEV) {
      // 开发期 Doro 初始属性更新：历史模板是 2/2/2，次要属性为 2/1/2/1。
      // 只修正匹配旧基础值的已招募宠物，不重置培养数据，也不持续覆盖策划手改。
      const pet = parsed.pets?.doro;
      const template = catalog.petTemplates.doro;
      const oldSecondary = { eloquence: 2, lore: 1, courage: 2, guile: 1 };
      if (pet && template && pet.baseStats.fitness === 2 && pet.baseStats.perception === 2 && pet.baseStats.technique === 2
        && (template.baseStats.fitness !== 2 || template.baseStats.perception !== 2 || template.baseStats.technique !== 2)) {
        // 留存修正前的原始存档，以便开发调试时恢复。
        localStorage.setItem(`${STORAGE_KEY}.before-doro-base-update`, raw);
        pet.baseStats = { ...template.baseStats };
        for (const stat of Object.keys(oldSecondary) as (keyof typeof oldSecondary)[]) {
          const gained = Math.max(0, (pet.secondaryStats[stat] ?? oldSecondary[stat]) - oldSecondary[stat]);
          pet.secondaryStats[stat] = template.secondaryStats[stat] + gained;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      }
    }
    // Doro 默认先天特质调整：只迁移旧默认，不覆盖其他手动配置或成长特质。
    if (catalog.petTemplates.doro?.innateTagId === "tag-lucky" && parsed.pets?.doro?.innateTagId === "tags-heartthrob") {
      parsed.pets.doro.innateTagId = "tag-lucky";
    }
    const itemAcquisitionCounts = parsed.itemAcquisitionCounts ?? {};
    const discoveredItemIds = Array.from(
      new Set([
        ...(parsed.discoveredItemIds ?? []),
        ...Object.entries(itemAcquisitionCounts).flatMap(([itemId, count]) =>
          count > 0 ? [itemId] : [],
        ),
      ]),
    );
    return {
      ...parsed,
      unlockedMapIds: [...new Set([
        ...(parsed.unlockedMapIds ?? []),
        ...(parsed.completedTaskIds ?? []).flatMap(id => catalog.tasks[id]?.reward.unlockMapIds ?? []).filter(id => !!catalog.maps[id]),
      ])],
      statResetCount: Number.isSafeInteger(parsed.statResetCount) && parsed.statResetCount >= 0 ? parsed.statResetCount : 0,
      itemAcquisitionCounts,
      discoveredItemIds,
      completedMilestoneIds: parsed.completedMilestoneIds ?? [],
      completedEventChoiceKeys: parsed.completedEventChoiceKeys ?? [],
      completedExtractionNodeKeys: parsed.completedExtractionNodeKeys ?? [],
      claimedExtractionRewards: parsed.claimedExtractionRewards ?? {},
      discoveredRouteKeys: parsed.discoveredRouteKeys ?? [],
      gacha: parsed.gacha ? { ...parsed.gacha, pending: parsed.gacha.pending ?? {} } : createGachaState(Date.now()),
      expeditions: (parsed.expeditions ?? []).map((expedition) => ({
        ...expedition,
        initialCargo: expedition.initialCargo ?? {},
        soldInitialCargo: expedition.soldInitialCargo ?? {},
      })),
    };
  } catch {
    return createInitialState();
  }
}

export function saveGame(state: GameState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearGame(): void {
  localStorage.removeItem(STORAGE_KEY);
}
