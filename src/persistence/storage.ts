import { createInitialState } from "../domain/engine";
import type { GameState } from "../domain/types";

// 不兼容的版本仍会重开；同版本新增的可选字段在这里做轻量补全，
// 避免 Demo 迭代时因为一个数组字段让现有存档失效。
const STORAGE_KEY = "idle-pet-adventure.demo.v1";
const SUPPORTED_VERSION = 9;
const VERSION_WITH_SIMPLIFIED_INJURY = 8;

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
  next.version = SUPPORTED_VERSION;

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

export function loadGame(): GameState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    let parsed = JSON.parse(raw) as GameState;
    if (parsed.version === 7) parsed = migrateVersion7(parsed);
    if (parsed.version === VERSION_WITH_SIMPLIFIED_INJURY) {
      parsed = migrateVersion8(parsed);
    }
    if (parsed.version !== SUPPORTED_VERSION) return createInitialState();
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
      statResetCount: Number.isSafeInteger(parsed.statResetCount) && parsed.statResetCount >= 0 ? parsed.statResetCount : 0,
      itemAcquisitionCounts,
      discoveredItemIds,
      completedMilestoneIds: parsed.completedMilestoneIds ?? [],
      completedExtractionNodeKeys: parsed.completedExtractionNodeKeys ?? [],
      discoveredRouteKeys: parsed.discoveredRouteKeys ?? [],
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
