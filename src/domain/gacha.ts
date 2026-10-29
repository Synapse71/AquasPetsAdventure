import { mapEntryNodeIds } from "./mapEntries";
import { catalog as defaultCatalog } from "./catalog";
import {
  GameRuleError,
  addInventory,
  addLog,
  createGachaState,
  grantXp,
  inventorySlots,
  lootXp,
  mapNodeXp,
  nextRandom,
  nodeLootCandidates,
  recordItemAcquisitions,
} from "./engine";
import { START_TRAVEL_DURATION_MS } from "./expeditionTiming";
import { RARITIES, RARITY_LABELS, type Rarity } from "./rarity";
import type {
  Catalog,
  GachaBudget,
  GachaDefinition,
  GachaPrize,
  GachaPrizeKind,
  GameState,
  Id,
  Inventory,
  MapDefinition,
  NodeLootDefinition,
} from "./types";

// 每日扭蛋：一天固定若干次免费，之后付费且价格按次数指数上涨。
// 机制见 docs/daily-gacha.md；所有数值都在配置台「抽奖」分类里。

export const DAILY_GACHA_ID = "daily";

const HOUR_MS = 60 * 60 * 1_000;
const PRIZE_KINDS: GachaPrizeKind[] = ["currency", "xp", "item"];

export function dailyGacha(catalog: Catalog = defaultCatalog): GachaDefinition | undefined {
  return catalog.gachas?.[DAILY_GACHA_ID];
}

/** 把时间折算成「抽奖日」：本地时间减去重置整点后的日期。 */
export function gachaDayKey(now: number, resetHour: number): string {
  const shifted = new Date(now - resetHour * HOUR_MS);
  const month = String(shifted.getMonth() + 1).padStart(2, "0");
  const day = String(shifted.getDate()).padStart(2, "0");
  return `${shifted.getFullYear()}-${month}-${day}`;
}

/** 解锁顺序里最后一张仍在目录中的地图，与探险默认选图同一口径（UE-07）。 */
export function latestUnlockedMapId(state: GameState, catalog: Catalog = defaultCatalog): Id | undefined {
  return [...state.unlockedMapIds].reverse().find((mapId) => catalog.maps[mapId]);
}

/** 最新地图没配预算时，沿解锁顺序往前找最近一张配了的。 */
export function gachaBudget(
  state: GameState,
  definition: GachaDefinition,
  catalog: Catalog = defaultCatalog,
): GachaBudget {
  const mapId = [...state.unlockedMapIds]
    .reverse()
    .find((id) => catalog.maps[id] && definition.budgets[id]);
  return mapId ? definition.budgets[mapId] : { currency: 0, xp: 0 };
}

/** 第 n 次付费（从 1 开始）的价格。 */
export function paidDrawPrice(definition: GachaDefinition, paidIndex: number): number {
  const { base, growth } = definition.paidPrice;
  return Math.max(1, Math.round(base * Math.pow(growth, paidIndex - 1)));
}

function currentDay(state: GameState, now: number, definition: GachaDefinition): GameState["gacha"] {
  const gacha = state.gacha ?? createGachaState(now);
  const dayKey = gachaDayKey(now, definition.resetHour);
  return gacha.dayKey === dayKey ? gacha : { ...gacha, dayKey, freeUsed: 0, paidCount: 0 };
}

export interface GachaStatus {
  freeLeft: number;
  paidCount: number;
  // 下一次要花的金币；还有免费次数时为 0。
  nextPrice: number;
  canDraw: boolean;
  pending: Inventory;
}

export function gachaStatus(
  state: GameState,
  now: number,
  catalog: Catalog = defaultCatalog,
): GachaStatus | undefined {
  const definition = dailyGacha(catalog);
  if (!definition) return undefined;
  const day = currentDay(state, now, definition);
  const freeLeft = Math.max(0, definition.dailyFreeDraws - day.freeUsed);
  const nextPrice = freeLeft > 0
    ? 0
    : paidDrawPrice(definition, day.paidCount + 1);
  return {
    freeLeft,
    paidCount: day.paidCount,
    nextPrice,
    canDraw: state.currency >= nextPrice,
    pending: day.pending,
  };
}

function weightedPick<T>(entries: { value: T; weight: number }[], seed: number): { value: T; seed: number } | undefined {
  const candidates = entries.filter((entry) => entry.weight > 0);
  const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
  if (!candidates.length || total <= 0) return undefined;
  const random = nextRandom(seed);
  let cursor = random.value * total;
  for (const entry of candidates) {
    cursor -= entry.weight;
    if (cursor < 0) return { value: entry.value, seed: random.seed };
  }
  return { value: candidates[candidates.length - 1].value, seed: random.seed };
}

/** 道具池里实际能抽到的条目：物品存在且权重为正。 */
function itemPoolByRarity(definition: GachaDefinition, catalog: Catalog): Map<Rarity, { value: Id; weight: number }[]> {
  const byRarity = new Map<Rarity, { value: Id; weight: number }[]>();
  for (const entry of definition.itemPool) {
    const item = catalog.items[entry.itemId];
    if (!item || !(entry.weight > 0)) continue;
    const list = byRarity.get(item.rarity) ?? [];
    list.push({ value: item.id, weight: entry.weight });
    byRarity.set(item.rarity, list);
  }
  return byRarity;
}

function spreadAmount(base: number, spread: number, seed: number): { value: number; seed: number } {
  const random = nextRandom(seed);
  const factor = 1 + spread * (random.value * 2 - 1);
  return { value: Math.max(1, Math.round(base * factor)), seed: random.seed };
}

/**
 * 开一颗蛋。只依赖 seed 与配置，同样的输入必然开出同样的奖励。
 * 抽不到的类别（预算为 0、道具池为空）不参与抽取，避免开出 0 金币的空蛋。
 */
export function rollGachaPrize(
  definition: GachaDefinition,
  budget: GachaBudget,
  seed: number,
  catalog: Catalog = defaultCatalog,
): { prize: GachaPrize; seed: number } {
  const pool = itemPoolByRarity(definition, catalog);
  const rarityEntries = RARITIES.filter((rarity) => pool.has(rarity)).map((rarity) => ({
    value: rarity,
    weight: definition.itemRarityWeights[rarity] ?? 0,
  }));
  const available: Record<GachaPrizeKind, boolean> = {
    currency: budget.currency * definition.currency.multiplier > 0,
    xp: budget.xp * definition.xp.multiplier > 0,
    item: rarityEntries.some((entry) => entry.weight > 0),
  };
  const kindDraw = weightedPick(
    PRIZE_KINDS.map((kind) => ({ value: kind, weight: available[kind] ? definition.prizeWeights[kind] : 0 })),
    seed,
  );
  if (!kindDraw) throw new GameRuleError("扭蛋配置没有可开出的奖励。");

  if (kindDraw.value === "item") {
    const rarityDraw = weightedPick(rarityEntries, kindDraw.seed)!;
    const itemDraw = weightedPick(pool.get(rarityDraw.value)!, rarityDraw.seed)!;
    return {
      prize: { kind: "item", amount: 1, itemId: itemDraw.value, rarity: rarityDraw.value },
      seed: itemDraw.seed,
    };
  }
  const tuning = definition[kindDraw.value];
  const base = (kindDraw.value === "currency" ? budget.currency : budget.xp) * tuning.multiplier;
  const amount = spreadAmount(base, tuning.spread, kindDraw.seed);
  return { prize: { kind: kindDraw.value, amount: amount.value }, seed: amount.seed };
}


function fitsWarehouse(state: GameState, additions: Inventory, catalog: Catalog): boolean {
  return inventorySlots(addInventory(state.inventory, additions), catalog) <= state.warehouseSlots;
}

function prizeLabel(prize: GachaPrize, catalog: Catalog): string {
  if (prize.kind === "currency") return `${prize.amount} 金币`;
  if (prize.kind === "xp") return `${prize.amount} 经验`;
  const item = catalog.items[prize.itemId!];
  return `${RARITY_LABELS[item?.rarity ?? "common"]}「${item?.name ?? prize.itemId}」`;
}

export function drawGacha(
  source: GameState,
  now = Date.now(),
  catalog: Catalog = defaultCatalog,
): GameState {
  const definition = dailyGacha(catalog);
  const status = gachaStatus(source, now, catalog);
  if (!definition || !status) throw new GameRuleError("扭蛋尚未配置。");
  if (!status.canDraw) throw new GameRuleError("金币不足。");

  const state = structuredClone(source);
  const day = currentDay(state, now, definition);
  const free = status.freeLeft > 0;
  state.currency -= status.nextPrice;
  const { prize, seed } = rollGachaPrize(definition, gachaBudget(state, definition, catalog), day.seed, catalog);
  const gacha = {
    ...day,
    freeUsed: day.freeUsed + (free ? 1 : 0),
    paidCount: day.paidCount + (free ? 0 : 1),
    seed,
    lastPrize: prize,
    pending: { ...day.pending },
  };

  if (prize.kind === "currency") {
    state.currency += prize.amount;
  } else if (prize.kind === "xp") {
    // 每只宠物各得一份完整经验，不平分；在外探险的也照样入账。
    for (const pet of Object.values(state.pets)) grantXp(pet, prize.amount);
  } else {
    const additions = { [prize.itemId!]: prize.amount };
    if (fitsWarehouse(state, additions, catalog)) {
      state.inventory = addInventory(state.inventory, additions);
      recordItemAcquisitions(state, additions);
    } else {
      gacha.pending = addInventory(gacha.pending, additions);
    }
  }
  state.gacha = gacha;
  addLog(state, `${free ? "每日免费扭蛋" : `花 ${status.nextPrice} 金币扭蛋`}，开出${prizeLabel(prize, catalog)}。`, now);
  return state;
}

/** 把待领取的道具尽量放进仓库，放不下的继续留着。 */
export function claimGachaPending(
  source: GameState,
  now = Date.now(),
  catalog: Catalog = defaultCatalog,
): GameState {
  const state = structuredClone(source);
  const pending = { ...(state.gacha?.pending ?? {}) };
  const claimed: Inventory = {};
  for (const [itemId, quantity] of Object.entries(pending)) {
    for (let index = 0; index < quantity; index += 1) {
      const one = { [itemId]: 1 };
      if (!fitsWarehouse(state, one, catalog)) break;
      state.inventory = addInventory(state.inventory, one);
      pending[itemId] -= 1;
      claimed[itemId] = (claimed[itemId] ?? 0) + 1;
    }
    if (pending[itemId] <= 0) delete pending[itemId];
  }
  if (!Object.keys(claimed).length) throw new GameRuleError("仓库已满，先腾出空位再领取。");
  recordItemAcquisitions(state, claimed);
  state.gacha = { ...state.gacha, pending };
  addLog(state, `领取了 ${Object.values(claimed).reduce((sum, value) => sum + value, 0)} 件待领取的奖励。`, now);
  return state;
}

// ---- 预算锚点：按地图配置估算探索收益 ----

export interface MapIncomeEstimate {
  // 所有完整路线（入口到终点）等概率时的平均值。
  durationMs: number;
  value: number;
  xp: number;
  pathCount: number;
}

function expectedNodeLoot(definition: NodeLootDefinition, catalog: Catalog): { value: number; xp: number } {
  const perRarity = new Map<Rarity, { value: number; xp: number }>();
  for (const rarity of RARITIES) {
    const items = nodeLootCandidates(definition, rarity, catalog);
    if (!items.length) continue;
    perRarity.set(rarity, {
      value: items.reduce((sum, item) => sum + (item.sellable ? item.sellValue ?? 0 : 0), 0) / items.length,
      xp: items.reduce((sum, item) => sum + lootXp({ [item.id]: 1 }, catalog), 0) / items.length,
    });
  }
  const rarityCounts: Partial<Record<Rarity, number>> = {};
  if (definition.mode === "independent") {
    const counts = definition.countWeights
      ? Object.entries(definition.countWeights).map(([count, weight]) => [Number(count), weight] as const)
      : Array.from({ length: definition.maxCount - definition.minCount + 1 }, (_, index) => [definition.minCount + index, 1] as const);
    const countTotal = counts.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
    const expectedCount = countTotal > 0 ? counts.reduce((sum, [count, weight]) => sum + count * Math.max(0, weight), 0) / countTotal : 0;
    const rarityTotal = RARITIES.reduce((sum, rarity) => sum + Math.max(0, definition.rarityWeights[rarity] ?? 0), 0);
    for (const rarity of RARITIES) {
      const weight = Math.max(0, definition.rarityWeights[rarity] ?? 0);
      if (rarityTotal > 0) rarityCounts[rarity] = (expectedCount * weight) / rarityTotal;
    }
  } else {
    const total = definition.compositions.reduce((sum, composition) => sum + Math.max(0, composition.weight), 0);
    for (const composition of definition.compositions) {
      if (total <= 0 || composition.weight <= 0) continue;
      for (const rarity of RARITIES) {
        rarityCounts[rarity] = (rarityCounts[rarity] ?? 0) + ((composition.rarityCounts[rarity] ?? 0) * composition.weight) / total;
      }
    }
  }
  let value = 0;
  let xp = 0;
  for (const rarity of RARITIES) {
    const each = perRarity.get(rarity);
    if (!each) continue;
    value += (rarityCounts[rarity] ?? 0) * each.value;
    xp += (rarityCounts[rarity] ?? 0) * each.xp;
  }
  return { value, xp };
}

/**
 * 估算一张地图一趟完整探索的平均耗时与收益。口径同 UE-05：
 * 所有完整路线等概率、背包容量充足，不计随机事件与首次撤离奖励。
 * 需要条件或隐藏的路线也计入，代表玩家成长后的稳态收益。
 */
export function estimateMapIncome(map: MapDefinition, catalog: Catalog = defaultCatalog): MapIncomeEstimate {
  const nodeXp = mapNodeXp(map.id, catalog);
  const nodeYield = new Map<Id, { value: number; xp: number }>();
  for (const node of Object.values(map.nodes)) {
    nodeYield.set(node.id, node.loot ? expectedNodeLoot(node.loot, catalog) : { value: 0, xp: 0 });
  }
  const paths: { durationMs: number; value: number; xp: number }[] = [];
  const walk = (nodeId: Id, visited: Set<Id>, durationMs: number, value: number, xp: number) => {
    const node = map.nodes[nodeId];
    if (!node) return;
    const edges = node.edges.filter((edge) => map.nodes[edge.toNodeId] && !visited.has(edge.toNodeId));
    if (node.terminal || !edges.length) {
      if (!mapEntryNodeIds(map).includes(nodeId)) paths.push({ durationMs, value, xp });
      return;
    }
    for (const edge of edges) {
      const gain = nodeYield.get(edge.toNodeId)!;
      walk(edge.toNodeId, new Set([...visited, edge.toNodeId]), durationMs + edge.durationMs, value + gain.value, xp + nodeXp + gain.xp);
    }
  };
  for (const entryId of mapEntryNodeIds(map)) walk(entryId, new Set([entryId]), START_TRAVEL_DURATION_MS, 0, 0);
  if (!paths.length) return { durationMs: 0, value: 0, xp: 0, pathCount: 0 };
  const mean = (pick: (path: (typeof paths)[number]) => number) => paths.reduce((sum, path) => sum + pick(path), 0) / paths.length;
  return { durationMs: mean((path) => path.durationMs), value: mean((path) => path.value), xp: mean((path) => path.xp), pathCount: paths.length };
}

/** 一张地图「探索 minutes 分钟」的收益，作为该图的每日抽奖预算。 */
export function suggestGachaBudget(map: MapDefinition, minutes: number, catalog: Catalog = defaultCatalog): GachaBudget {
  const income = estimateMapIncome(map, catalog);
  if (income.durationMs <= 0) return { currency: 0, xp: 0 };
  const scale = (minutes * 60 * 1_000) / income.durationMs;
  return { currency: Math.round(income.value * scale), xp: Math.round(income.xp * scale) };
}

/** 某个配置下一颗蛋的期望：金币当量（道具按售价）与经验。供配置台展示。 */
export function expectedGachaPrize(
  definition: GachaDefinition,
  budget: GachaBudget,
  catalog: Catalog = defaultCatalog,
): Record<GachaPrizeKind, number> & { probability: Record<GachaPrizeKind, number> } {
  const pool = itemPoolByRarity(definition, catalog);
  const rarityEntries = RARITIES.filter((rarity) => pool.has(rarity)).map((rarity) => ({ rarity, weight: Math.max(0, definition.itemRarityWeights[rarity] ?? 0) }));
  const rarityTotal = rarityEntries.reduce((sum, entry) => sum + entry.weight, 0);
  let itemValue = 0;
  for (const { rarity, weight } of rarityEntries) {
    const entries = pool.get(rarity)!;
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    const avg = entries.reduce((sum, entry) => {
      const item = catalog.items[entry.value];
      return sum + (item.sellable ? item.sellValue ?? 0 : 0) * entry.weight;
    }, 0) / total;
    if (rarityTotal > 0) itemValue += (avg * weight) / rarityTotal;
  }
  const available: Record<GachaPrizeKind, boolean> = {
    currency: budget.currency * definition.currency.multiplier > 0,
    xp: budget.xp * definition.xp.multiplier > 0,
    item: rarityTotal > 0,
  };
  const kindTotal = PRIZE_KINDS.reduce((sum, kind) => sum + (available[kind] ? Math.max(0, definition.prizeWeights[kind]) : 0), 0);
  const probability = Object.fromEntries(
    PRIZE_KINDS.map((kind) => [kind, kindTotal > 0 && available[kind] ? Math.max(0, definition.prizeWeights[kind]) / kindTotal : 0]),
  ) as Record<GachaPrizeKind, number>;
  return {
    currency: budget.currency * definition.currency.multiplier,
    xp: budget.xp * definition.xp.multiplier,
    item: itemValue,
    probability,
  };
}
