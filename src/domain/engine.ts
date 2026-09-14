import { catalog as defaultCatalog } from "./catalog";
import { RARITIES, type Rarity } from "./rarity";
import type {
  Catalog,
  EventChoiceDefinition,
  EventChoiceResolution,
  EventResolution,
  Expedition,
  GameState,
  Id,
  InjuryStage,
  Inventory,
  ItemDefinition,
  MapEdgeDefinition,
  NodeLootDefinition,
  Pet,
  RiskBand,
  RiskPreview,
  SecondaryRequirement,
  SecondaryStatKey,
  Settlement,
  StartExpeditionInput,
  StatKey,
  Stats,
} from "./types";
import { isPlayerMilestoneId, type PlayerMilestoneId } from "./milestones";

const GAME_VERSION = 9;
const INJURY_ORDER: InjuryStage[] = ["healthy", "injured", "incapacitated"];

export const INJURY_LABELS: Record<InjuryStage, string> = {
  healthy: "正常",
  injured: "受伤",
  incapacitated: "失能",
};

export const STAT_LABELS: Record<StatKey, string> = {
  fitness: "体能",
  perception: "感知",
  technique: "技巧",
};

export const SECONDARY_STAT_KEYS: SecondaryStatKey[] = [
  "eloquence",
  "lore",
  "courage",
  "guile",
];

export const SECONDARY_STAT_LABELS: Record<SecondaryStatKey, string> = {
  eloquence: "口才",
  lore: "学识",
  courage: "勇气",
  guile: "狡黠",
};

// ——— 可调数值集中在这里 ———

// 仓库初始格子数。任务奖励和花钱扩容都在这个基础上往上加。
const INITIAL_WAREHOUSE_SLOTS = 40;
const WAREHOUSE_EXPANSION_SLOTS = 10;
// ——— 负重与格子 ———
//
// 单宠负重上限 = CARRY_BASE + 体能 × CARRY_PER_FITNESS，再乘伤势倍率，队伍相加。
// 单宠格子上限 = SLOTS_BASE + 技巧 × SLOTS_PER_TECHNIQUE，队伍相加。
//
// 这四个数不能各自单独调：分水岭 = 负重上限 ÷ 格子上限，
// 物品的「每格满载重量」高于分水岭就先撞负重（体能吃紧），低于就先撞格子（技巧吃紧）。
// 按 2026-08-14 的物品表，每格满载重量中位 1.65、每格只放一件时中位 0.60，
// 体能 2 / 技巧 2 时分水岭 7.4 ÷ 10 = 0.74，正好落在两者之间。
export const CARRY_BASE = 5;
export const CARRY_PER_FITNESS = 1.2;
export const SLOTS_BASE = 8;
export const SLOTS_PER_TECHNIQUE = 1;

// 搬运一名失能队友要占掉的负重。
// 不能大到让任何一次失能都直接把可带回容量清零：设计文档 8.3 把
// 「放弃全部战利品」定为最坏情况，不是必然结果。
const RESCUE_BURDEN = 4;
export const MAX_TEAM_PETS = 3;

// ——— 次要属性 ———
//
// 所有宠物每一项共用同一个上限（设计文档 6.5.3）。
const SECONDARY_STAT_CAP = 20;

// ——— 等级与经验 ———
//
// 升到下一级需要 等级^1.4 × XP_CURVE_K。指数取 1.4 是因为地图经验系数会随进度
// 上升，线性曲线会被后期地图的产出直接冲垮；而更陡的二次或指数曲线，其陡峭段
// 全部落在 20 级以外，在当前上限下根本用不到。
const MAX_LEVEL = 20;
const XP_CURVE_EXPONENT = 1.4;
const XP_CURVE_K = 20;
const POINTS_PER_LEVEL = 1;

// 每个已完成节点的基础经验，再乘地图经验系数。
const NODE_XP = 10;
// 溃败只给节点经验的一半，且没有战利品经验（文档 3.9 的「基础经验」）。
const DEFEAT_XP_RATIO = 0.5;
const MIN_DEFEAT_XP = 5;

// 带回来的战利品按稀有度给经验，同样乘地图经验系数。
// 白绿两档为 0：那是随处可见的东西，不构成「见识」。
const LOOT_XP_BY_RARITY: Record<Rarity, number> = {
  common: 0,
  uncommon: 0,
  rare: 2,
  epic: 8,
  legendary: 30,
  mythic: 100,
};
// 物品没写 stackSize 就按一件一格算。
const DEFAULT_STACK_SIZE = 1;

// 各伤势档位恢复到下一档所需的真实时间。只在基地里流逝。
const INJURY_RECOVERY_MS: Record<InjuryStage, number> = {
  healthy: 0,
  injured: 30 * 60 * 1_000,
  incapacitated: 4 * 60 * 60 * 1_000,
};

// 花钱立刻治好当前档位的伤，一次付清直接回到正常。
const INJURY_HEAL_COST: Record<InjuryStage, number> = {
  healthy: 0,
  injured: 200,
  incapacitated: 4_000,
};

export class GameRuleError extends Error {}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function clonePetTemplate(template: Pet): Pet {
  const pet = clone(template);
  // 兼容仍从旧配置草稿创建宠物的情况：旧“重伤”并入新“受伤”。
  if ((pet.injury as string) === "critical") pet.injury = "injured";
  return pet;
}

function nextRandom(seed: number): { value: number; seed: number } {
  let value = seed | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return {
    value: (value >>> 0) / 4_294_967_296,
    seed: value >>> 0 || 1,
  };
}

function nextId(state: GameState, prefix: string): string {
  const id = `${prefix}-${state.nextId}`;
  state.nextId += 1;
  return id;
}

function addLog(state: GameState, message: string, now = Date.now()): void {
  state.log.unshift({ id: nextId(state, "log"), createdAt: now, message });
  state.log = state.log.slice(0, 80);
}

export function createInitialState(): GameState {
  // 不再写死具体内容 ID：初始宠物取目录里的第一个模板，
  // 起始地图取编号最小的一张，这样换内容不用改引擎。
  const starterPet = Object.values(defaultCatalog.petTemplates)[0];
  const firstMap = Object.values(defaultCatalog.maps).sort(
    (a, b) => a.number - b.number,
  )[0];
  if (!starterPet || !firstMap) {
    throw new GameRuleError("配置至少需要一个宠物模板和一张地图。");
  }
  const initialPet = clonePetTemplate(starterPet);
  return {
    version: GAME_VERSION,
    currency: 0,
    statResetCount: 0,
    warehouseSlots: INITIAL_WAREHOUSE_SLOTS,
    inventory: {},
    lockedItemIds: [],
    itemAcquisitionCounts: {},
    discoveredItemIds: [],
    pets: {
      [starterPet.id]: initialPet,
    },
    unlockedMapIds: [firstMap.id],
    completedTaskIds: [],
    completedMilestoneIds: [],
    reachedEndpointIds: [],
    completedExtractionNodeKeys: [],
    discoveredNodeIds: [],
    discoveredRouteKeys: [],
    expeditions: [],
    settlements: [],
    log: [],
    nextId: 1,
  };
}

export function addInventory(
  inventory: Inventory,
  additions: Inventory,
): Inventory {
  const result = { ...inventory };
  for (const [itemId, quantity] of Object.entries(additions)) {
    if (quantity <= 0) continue;
    result[itemId] = (result[itemId] ?? 0) + quantity;
  }
  return result;
}

export function removeInventory(
  inventory: Inventory,
  removals: Inventory,
): Inventory {
  const result = { ...inventory };
  for (const [itemId, quantity] of Object.entries(removals)) {
    if (quantity <= 0) continue;
    if ((result[itemId] ?? 0) < quantity) {
      throw new GameRuleError(`物品不足：${itemId}`);
    }
    result[itemId] -= quantity;
    if (result[itemId] <= 0) delete result[itemId];
  }
  return result;
}

// 物品重量定义在 0.1 的刻度上，累加会产生浮点误差
// （0.1 + 0.2 = 0.30000000000000004）。误差既会污染界面数字，
// 也会让"刚好装满"被判成超载，所以求和后统一吸附回刻度。
export function roundWeight(value: number): number {
  return Math.round(value * 10) / 10;
}

export function inventoryWeight(
  inventory: Inventory,
  catalog: Catalog = defaultCatalog,
): number {
  return roundWeight(
    Object.entries(inventory).reduce((total, [itemId, quantity]) => {
      return total + (catalog.items[itemId]?.weight ?? 0) * quantity;
    }, 0),
  );
}

export function itemStackSize(
  itemId: string,
  catalog: Catalog = defaultCatalog,
): number {
  const configured = catalog.items[itemId]?.stackSize;
  return configured && configured > 0 ? configured : DEFAULT_STACK_SIZE;
}

// 同一种物品先把自己堆满一格再占下一格，不同物品之间不共享格子。
export function inventorySlots(
  inventory: Inventory,
  catalog: Catalog = defaultCatalog,
): number {
  return Object.entries(inventory).reduce((total, [itemId, quantity]) => {
    if (quantity <= 0) return total;
    return total + Math.ceil(quantity / itemStackSize(itemId, catalog));
  }, 0);
}

export function petStats(pet: Pet): Stats {
  return {
    fitness: pet.baseStats.fitness + pet.allocatedStats.fitness,
    perception: pet.baseStats.perception + pet.allocatedStats.perception,
    technique: pet.baseStats.technique + pet.allocatedStats.technique,
  };
}

export function injuryMultiplier(stage: InjuryStage): number {
  switch (stage) {
    case "healthy":
      return 1;
    case "injured":
      return 0.75;
    case "incapacitated":
      return 0;
  }
}

export function petTags(pet: Pet): string[] {
  return [
    ...(pet.innateTagId ? [pet.innateTagId] : []),
    ...pet.growthTagIds,
  ];
}

export function petEffectiveStats(pet: Pet): Stats {
  const total = petStats(pet), multiplier = injuryMultiplier(pet.injury);
  return {
    fitness: Math.max(0, Math.floor(total.fitness * multiplier)),
    perception: Math.max(0, Math.floor(total.perception * multiplier)),
    technique: Math.max(0, Math.floor(total.technique * multiplier)),
  };
}

export function petCarryCapacity(pet: Pet): number {
  return roundWeight((CARRY_BASE + petStats(pet).fitness * CARRY_PER_FITNESS) * injuryMultiplier(pet.injury));
}

export function petSlotCapacity(pet: Pet): number {
  return Math.floor(SLOTS_BASE + petStats(pet).technique * SLOTS_PER_TECHNIQUE);
}

export function teamStat(
  state: GameState,
  expedition: Expedition,
  stat: StatKey,
): number {
  const values = expedition.petIds
    .map((id) => state.pets[id])
    .filter(Boolean)
    .filter((pet) => pet.injury !== "incapacitated")
    .map((pet) => petEffectiveStats(pet)[stat])
    .sort((a, b) => b - a);

  if (!values.length) return 0;
  const assistance = values.slice(1).reduce((sum, value) => sum + Math.min(1, value), 0);
  return values[0] + assistance;
}

export function teamStatForPets(
  state: GameState,
  petIds: Id[],
  stat: StatKey,
): number {
  return teamStat(state, { petIds } as Expedition, stat);
}

export type MapInformationTier = 1 | 2 | 3;

export function mapInformationTier(
  state: GameState,
  mapId: Id,
  petIds: Id[],
  catalog: Catalog = defaultCatalog,
): MapInformationTier {
  const map = catalog.maps[mapId];
  if (!map) return 1;
  const thresholds = map.informationThresholds ?? { partial: 2, full: 4 };
  const perception = teamStatForPets(state, petIds, "perception");
  if (perception >= thresholds.full) return 3;
  if (perception >= thresholds.partial) return 2;
  return 1;
}

export function routeDiscoveryKey(
  mapId: Id,
  fromNodeId: Id,
  edgeId: Id,
): string {
  return `${mapId}:${fromNodeId}:${edgeId}`;
}

export function isRouteDiscovered(
  state: GameState,
  mapId: Id,
  fromNodeId: Id,
  edgeId: Id,
): boolean {
  return (state.discoveredRouteKeys ?? []).includes(
    routeDiscoveryKey(mapId, fromNodeId, edgeId),
  );
}

export function teamHasTag(
  state: GameState,
  expedition: Expedition,
  tagId: string,
): boolean {
  return expedition.petIds.some((petId) =>
    petTags(state.pets[petId]).includes(tagId),
  );
}

export function petSecondaryStat(pet: Pet, stat: SecondaryStatKey): number {
  return pet.secondaryStats?.[stat] ?? 0;
}

// 可行动成员中取最高值，不叠加，也不乘受伤倍率（设计文档 6.5.1）。
// 受伤不会让硬门槛在一轮内跳变；失能则代表已经无法执行对应行动。
export function teamSecondaryStat(
  state: GameState,
  petIds: Id[],
  stat: SecondaryStatKey,
): number {
  return petIds.reduce((best, petId) => {
    const pet = state.pets[petId];
    return pet && pet.injury !== "incapacitated"
      ? Math.max(best, petSecondaryStat(pet, stat))
      : best;
  }, 0);
}

export interface GateStatus {
  met: boolean;
  stat: SecondaryStatKey;
  required: number;
  current: number;
  /** 完整门槛文案；展示层会在第一档情报中隐藏具体数字。 */
  label: string;
}

export function checkSecondaryRequirement(
  state: GameState,
  petIds: Id[],
  requirement: SecondaryRequirement,
): GateStatus {
  const current = teamSecondaryStat(state, petIds, requirement.stat);
  const name = SECONDARY_STAT_LABELS[requirement.stat];
  return {
    met: current >= requirement.value,
    stat: requirement.stat,
    required: requirement.value,
    current,
    label: `需要${name} ${requirement.value}（当前 ${current}）`,
  };
}

export function teamCarryCapacity(
  state: GameState,
  expedition: Expedition,
  catalog: Catalog = defaultCatalog,
): number {
  // 负重只来自体能和工具，Tag 不参与——见 TagDefinition 的说明。
  const petCapacity = expedition.petIds.reduce((total, petId) => {
    const pet = state.pets[petId];
    if (!pet) return total;
    // 吸附到 0.1 刻度而不是取整：系数是小数，Math.floor 会把它吃掉
    // （体能 2 的 7.4 会变成 7，每点体能的实际收益退化成不均匀的 +1）。
    return roundWeight(total + petCarryCapacity(pet));
  }, 0);

  const rescueBurden =
    expedition.petIds.filter(
      (petId) => state.pets[petId]?.injury === "incapacitated",
    ).length * RESCUE_BURDEN;

  return Math.max(0, roundWeight(petCapacity - rescueBurden));
}

export function cargoCapacity(
  state: GameState,
  expedition: Expedition,
  catalog: Catalog = defaultCatalog,
): number {
  // 没有永久占重的装备了（工具已并入普通物品），
  // 所以可带回容量就是队伍负重上限本身。
  return teamCarryCapacity(state, expedition, catalog);
}

// 背包格子和负重是两条独立的限制：负重可以超（按梯度加风险），
// 格子不能超（超了就阻塞后续行动，必须先整理）。
export function cargoSlotCapacity(
  state: GameState,
  expedition: Expedition,
  catalog: Catalog = defaultCatalog,
): number {
  // 格子由技巧提供，和负重由体能提供是对称的。
  // 与负重不同的是格子不乘伤势倍率——受伤的宠物背不动那么重，但包还是那么大。
  const petSlots = expedition.petIds.reduce((total, petId) => {
    const pet = state.pets[petId];
    if (!pet) return total;
    return (
      total +
      petSlotCapacity(pet)
    );
  }, 0);
  return Math.max(0, petSlots);
}

export function cargoSlotsUsed(
  expedition: Expedition,
  catalog: Catalog = defaultCatalog,
): number {
  return inventorySlots(expedition.cargo, catalog);
}

export function isCargoOverSlots(
  state: GameState,
  expedition: Expedition,
  catalog: Catalog = defaultCatalog,
): boolean {
  return (
    cargoSlotsUsed(expedition, catalog) >
    cargoSlotCapacity(state, expedition, catalog)
  );
}

export function overloadRatio(
  state: GameState,
  expedition: Expedition,
  catalog: Catalog = defaultCatalog,
): number {
  const capacity = teamCarryCapacity(state, expedition, catalog);
  const carried = inventoryWeight(expedition.cargo, catalog);
  if (capacity <= 0) return carried > 0 ? 2 : 0;
  return carried / capacity;
}

export function overloadPenalty(ratio: number): number {
  if (ratio <= 1) return 0;
  if (ratio <= 1.15) return 1;
  if (ratio <= 1.35) return 2;
  return 4;
}

function injuryPenalty(state: GameState, expedition: Expedition): number {
  return expedition.petIds.reduce((total, petId) => {
    const stage = state.pets[petId]?.injury;
    if (stage === "injured") return total + 0.5;
    if (stage === "incapacitated") return total + 2;
    return total;
  }, 0);
}

// 风险只由主属性、超载、伤势和工具决定。Tag 不进这条公式：
// 全局降风险等同于「所有主属性 +X」，正是设计文档 7.1 禁止的那种数值加成。
function riskScore(
  state: GameState,
  expedition: Expedition,
  choice: EventChoiceDefinition,
  catalog: Catalog,
): number {
  const resolution = choiceResolution(choice);
  if (resolution.type !== "primary") return 0;
  return (
    resolution.difficulty -
    teamStat(state, expedition, resolution.stat) +
    overloadPenalty(overloadRatio(state, expedition, catalog)) +
    injuryPenalty(state, expedition)
  );
}

function choiceResolution(
  choice: EventChoiceDefinition,
): EventChoiceResolution {
  if (choice.resolution) return choice.resolution;
  return {
    type: "primary",
    stat: choice.stat ?? "perception",
    difficulty: choice.difficulty ?? 0,
  };
}

interface PrimaryOutcomeProbabilities {
  extraSuccess: number;
  success: number;
  failure: number;
  bigFailure: number;
}

export function primaryOutcomeForRoll(roll: number, risk: number): Exclude<EventResolution["outcome"], "leave"> {
  const margin = roll - risk;
  return margin >= 6 ? "extra-success" : margin >= 3 ? "success" : margin >= 0 ? "failure" : "big-failure";
}

export function eventCheckRisk(state: GameState, expeditionId: string, choiceId: string, catalog: Catalog = defaultCatalog): number | undefined {
  const expedition = requireExpedition(state, expeditionId);
  const choice = catalog.events[expedition.currentEventId ?? ""]?.choices.find(c => c.id === choiceId);
  if (!choice || choiceResolution(choice).type !== "primary" || mapInformationTier(state, expedition.mapId, expedition.petIds, catalog) !== 3) return undefined;
  return riskScore(state, expedition, choice, catalog);
}

function primaryOutcomeProbabilities(
  score: number,
  hasAdvantage: boolean,
): PrimaryOutcomeProbabilities {
  const counts = {
    extraSuccess: 0,
    success: 0,
    failure: 0,
    bigFailure: 0,
  };
  const rolls: number[] = [];
  if (hasAdvantage) {
    for (let first = 1; first <= 6; first += 1) {
      for (let second = 1; second <= 6; second += 1) {
        rolls.push(Math.max(first, second));
      }
    }
  } else {
    rolls.push(1, 2, 3, 4, 5, 6);
  }

  for (const roll of rolls) {
    const key = { 'extra-success': 'extraSuccess', success: 'success', failure: 'failure', 'big-failure': 'bigFailure' } as const;
    counts[key[primaryOutcomeForRoll(roll, score)]] += 1;
  }

  return {
    extraSuccess: counts.extraSuccess / rolls.length,
    success: counts.success / rolls.length,
    failure: counts.failure / rolls.length,
    bigFailure: counts.bigFailure / rolls.length,
  };
}

function riskBand(probability: number): RiskBand {
  if (probability === 0) return "稳妥";
  if (probability <= 0.3) return "冒险";
  if (probability < 0.6) return "危险";
  return "极其危险";
}

function formatProbability(probability: number): string {
  return `${Number((probability * 100).toFixed(1))}%`;
}

export function getRiskPreview(
  state: GameState,
  expeditionId: string,
  choiceId: string,
  catalog: Catalog = defaultCatalog,
): RiskPreview {
  const expedition = requireExpedition(state, expeditionId);
  const event = catalog.events[expedition.currentEventId ?? ""];
  const choice = event?.choices.find((candidate) => candidate.id === choiceId);
  if (!choice) throw new GameRuleError("找不到事件选项。");

  const resolution = choiceResolution(choice);
  const informationTier = mapInformationTier(
    state,
    expedition.mapId,
    expedition.petIds,
    catalog,
  );
  if (resolution.type === "secondary") {
    const current = teamSecondaryStat(
      state,
      expedition.petIds,
      resolution.stat,
    );
    const label = SECONDARY_STAT_LABELS[resolution.stat];
    if (informationTier === 3) {
      return {
        label: `成功条件 · ${label}达到 ${resolution.successThreshold}`,
        detail: `大成功条件 · ${label}达到 ${resolution.extraSuccessThreshold}`,
        bigFailureProbability: 0,
      };
    }
    if (current < resolution.successThreshold) {
      return {
        label: informationTier === 1
          ? `${label}不足`
          : `需要${label}达到 ${resolution.successThreshold}`,
        detail: "",
        bigFailureProbability: 0,
      };
    }
    return {
      label: "",
      detail: "",
      bigFailureProbability: 0,
    };
  }
  if (resolution.type === "leave") {
    return {
      label: "安全离开",
      detail: "不进行检定，也不会获得奖励或承受事件损失。",
      bigFailureProbability: 0,
    };
  }

  const score = riskScore(state, expedition, choice, catalog);
  const advantage = hasEventRollAdvantage(state, expedition, catalog);
  const probabilities = primaryOutcomeProbabilities(score, advantage);
  const probability = probabilities.bigFailure;
  const band = riskBand(probability);
  const secondaryGateDetail = choice.requiredSecondary && informationTier === 3
    ? (() => {
        const gate = checkSecondaryRequirement(
          state,
          expedition.petIds,
          choice.requiredSecondary,
        );
        return `选择条件 · ${SECONDARY_STAT_LABELS[gate.stat]}达到 ${gate.required}。`;
      })()
    : "";

  if (informationTier === 1) {
    return {
      label: "风险未知",
      detail: "当前情报不足，无法判断这个选择的危险程度。",
      bigFailureProbability: null,
    };
  }

  if (informationTier === 2) {
    return {
      label: band,
      detail: `已根据当前队伍状态判断风险档位。${secondaryGateDetail}`,
      bigFailureProbability: probability,
    };
  }

  return {
    label: band,
    detail: `大成功 ${formatProbability(probabilities.extraSuccess)} · 成功 ${formatProbability(probabilities.success)} · 失败 ${formatProbability(probabilities.failure)} · 大失败 ${formatProbability(probabilities.bigFailure)}${advantage ? "（幸运儿：两次掷骰取高）" : ""}${secondaryGateDetail ? `。${secondaryGateDetail}` : ""}`,
    bigFailureProbability: probability,
    probabilities,
  };
}

function requireExpedition(state: GameState, expeditionId: string): Expedition {
  const expedition = state.expeditions.find(({ id }) => id === expeditionId);
  if (!expedition) throw new GameRuleError("找不到这支冒险队伍。");
  return expedition;
}

function requirePetAvailable(state: GameState, petId: string): void {
  if (!state.pets[petId]) throw new GameRuleError("宠物不存在。");
  // 战报只是只读记录，不再占用宠物，所以这里只看是否正在外出。
  const assigned = state.expeditions.some((entry) =>
    entry.petIds.includes(petId),
  );
  if (assigned) throw new GameRuleError("宠物正在执行其他行动。");
  // 带伤可以出门，只是能力和负重打折、风险更高；只有失能才拦。
  if (state.pets[petId].injury === "incapacitated") {
    throw new GameRuleError("失能的宠物不能出发，需要先恢复或治疗。");
  }
}

export function startExpedition(
  source: GameState,
  input: StartExpeditionInput,
  now = Date.now(),
  catalog: Catalog = defaultCatalog,
): GameState {
  const state = clone(source);
  const map = catalog.maps[input.mapId];
  if (!map || !state.unlockedMapIds.includes(input.mapId)) {
    throw new GameRuleError("地图尚未解锁。");
  }
  if (!input.petIds.length) throw new GameRuleError("至少选择一只宠物。");
  if (input.petIds.length > MAX_TEAM_PETS) {
    throw new GameRuleError(`一支队伍最多编入 ${MAX_TEAM_PETS} 只宠物。`);
  }
  if (new Set(input.petIds).size !== input.petIds.length) {
    throw new GameRuleError("同一只宠物不能重复出勤。");
  }
  input.petIds.forEach((petId) => requirePetAvailable(state, petId));

  const initialCargo = clone(input.cargo ?? {});
  for (const [itemId, quantity] of Object.entries(initialCargo)) {
    if (!catalog.items[itemId]) {
      throw new GameRuleError(`携带物品不存在：${itemId}`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new GameRuleError(`携带数量必须是正整数：${itemId}`);
    }
    if ((state.inventory[itemId] ?? 0) < quantity) {
      throw new GameRuleError(`仓库物品不足：${catalog.items[itemId].name}`);
    }
  }
  // 出门就停表：带伤上路不会在途中自愈，回来才重新开始恢复。
  input.petIds.forEach((petId) => {
    delete state.pets[petId].injuryRecoveredAt;
  });

  const id = nextId(state, "expedition");
  const seed = Math.max(1, (now ^ state.nextId * 2_654_435_761) >>> 0);
  const expedition: Expedition = {
    id,
    mapId: map.id,
    petIds: [...input.petIds],
    phase: "traveling",
    targetNodeId: map.startNodeId,
    startedAt: now,
    arriveAt: now + map.startDurationMs,
    cargo: initialCargo,
    initialCargo: clone(initialCargo),
    arrivalLoot: {},
    soldDuringExtraction: {},
    soldInitialCargo: {},
    visitedNodeIds: [],
    drawnEventIds: [],
    currentSeed: seed,
    completedNodeCount: 0,
  };
  const usedSlots = cargoSlotsUsed(expedition, catalog);
  const slotCapacity = cargoSlotCapacity(state, expedition, catalog);
  if (usedSlots > slotCapacity) {
    throw new GameRuleError(
      `初始携带物品占用 ${usedSlots} 格，超过队伍背包上限 ${slotCapacity} 格。`,
    );
  }
  state.inventory = removeInventory(state.inventory, initialCargo);
  state.expeditions.push(expedition);
  const cargoCount = Object.values(initialCargo).reduce(
    (sum, quantity) => sum + quantity,
    0,
  );
  addLog(
    state,
    `${input.petIds.map((petId) => state.pets[petId].name).join("、")}携带 ${cargoCount} 件物品出发前往${map.name}。`,
    now,
  );
  return state;
}

function nodeEventIds(
  nodeId: string,
  mapId: string,
  catalog: Catalog,
): string[] {
  const node = catalog.maps[mapId]?.nodes[nodeId];
  if (!node) return [];
  return (node.eventPoolIds ?? []).flatMap(
    (poolId) => catalog.eventPools[poolId]?.eventIds ?? [],
  );
}

function weightedPick<T>(
  entries: { value: T; weight: number }[],
  seed: number,
): { value: T; seed: number } {
  const candidates = entries.filter((entry) => entry.weight > 0);
  const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
  if (!candidates.length || total <= 0) {
    throw new GameRuleError("掉落表没有可抽取的正权重条目。");
  }
  const random = nextRandom(seed);
  let cursor = random.value * total;
  for (const entry of candidates) {
    cursor -= entry.weight;
    if (cursor < 0) return { value: entry.value, seed: random.seed };
  }
  return { value: candidates[candidates.length - 1].value, seed: random.seed };
}

function nodeLootCandidates(
  definition: NodeLootDefinition,
  rarity: Rarity,
  catalog: Catalog,
): ItemDefinition[] {
  const whitelist = new Set(definition.whitelistItemIds ?? []);
  const blacklist = new Set(definition.blacklistItemIds ?? []);
  const whitelistTags = new Set(definition.whitelistItemTags ?? []);
  const blacklistTags = new Set(definition.blacklistItemTags ?? []);
  return Object.values(catalog.items).filter((item) => {
    const itemTags = item.tags ?? [];
    const matchesWhitelist =
      (!whitelist.size && !whitelistTags.size) ||
      whitelist.has(item.id) ||
      itemTags.some((tag) => whitelistTags.has(tag));
    const matchesBlacklist =
      blacklist.has(item.id) ||
      itemTags.some((tag) => blacklistTags.has(tag));
    return (
      item.rarity === rarity &&
      // Tag 成长道具只能来自关键任务或首次奖励，不能混入普通随机池。
      !item.tagGrantId &&
      matchesWhitelist &&
      !matchesBlacklist
    );
  });
}

export function nodeLootMaximumRarity(
  definition: NodeLootDefinition | undefined,
  catalog: Catalog = defaultCatalog,
): Rarity | undefined {
  if (!definition) return undefined;
  const possible = new Set<Rarity>();
  if (definition.mode === "independent") {
    for (const rarity of RARITIES) {
      if ((definition.rarityWeights[rarity] ?? 0) > 0) possible.add(rarity);
    }
  } else {
    for (const composition of definition.compositions) {
      if (composition.weight <= 0) continue;
      for (const rarity of RARITIES) {
        if ((composition.rarityCounts[rarity] ?? 0) > 0) possible.add(rarity);
      }
    }
  }
  return [...RARITIES]
    .reverse()
    .find(
      (rarity) =>
        possible.has(rarity) &&
        nodeLootCandidates(definition, rarity, catalog).length > 0,
    );
}

function drawLootItem(
  definition: NodeLootDefinition,
  rarity: Rarity,
  seed: number,
  catalog: Catalog,
): { itemId: Id; seed: number } {
  const candidates = nodeLootCandidates(definition, rarity, catalog);
  if (!candidates.length) {
    throw new GameRuleError(`掉落表的${rarity}档没有可用物品。`);
  }
  const random = nextRandom(seed);
  const index = Math.min(
    candidates.length - 1,
    Math.floor(random.value * candidates.length),
  );
  return { itemId: candidates[index].id, seed: random.seed };
}

/**
 * 按节点唯一的掉落配置生成抵达基础战利品。相同 seed 与目录必然得到相同结果。
 * 独立模式逐件抽稀有度；组合模式先抽最终构成，再逐档抽具体物品。
 */
export function drawNodeLoot(
  definition: NodeLootDefinition,
  seed: number,
  catalog: Catalog = defaultCatalog,
): { loot: Inventory; seed: number } {
  let currentSeed = seed;
  let loot: Inventory = {};

  if (definition.mode === "independent") {
    const countEntries = definition.countWeights
      ? Object.entries(definition.countWeights).map(([count, weight]) => ({
          value: Number(count),
          weight,
        }))
      : Array.from(
          { length: definition.maxCount - definition.minCount + 1 },
          (_, index) => ({ value: definition.minCount + index, weight: 1 }),
        );
    const countDraw = weightedPick(countEntries, currentSeed);
    currentSeed = countDraw.seed;

    const rarityEntries = RARITIES.map((rarity) => ({
      value: rarity,
      weight: definition.rarityWeights[rarity] ?? 0,
    }));
    for (let index = 0; index < countDraw.value; index += 1) {
      const rarityDraw = weightedPick(rarityEntries, currentSeed);
      currentSeed = rarityDraw.seed;
      const itemDraw = drawLootItem(
        definition,
        rarityDraw.value,
        currentSeed,
        catalog,
      );
      currentSeed = itemDraw.seed;
      loot = addInventory(loot, { [itemDraw.itemId]: 1 });
    }
  } else {
    const compositionDraw = weightedPick(
      definition.compositions.map((composition) => ({
        value: composition,
        weight: composition.weight,
      })),
      currentSeed,
    );
    currentSeed = compositionDraw.seed;
    for (const rarity of RARITIES) {
      const count = compositionDraw.value.rarityCounts[rarity] ?? 0;
      for (let index = 0; index < count; index += 1) {
        const itemDraw = drawLootItem(
          definition,
          rarity,
          currentSeed,
          catalog,
        );
        currentSeed = itemDraw.seed;
        loot = addInventory(loot, { [itemDraw.itemId]: 1 });
      }
    }
  }

  return { loot, seed: currentSeed };
}

/**
 * 某个节点因次要属性不足而够不到的事件。
 *
 * 事件在抵达时才抽取，所以这份清单第一次只能是事后得知；但它由「访问过的节点 +
 * 目录」推导，不需要额外存档字段，因此一旦节点进过 discoveredNodeIds，
 * 玩家在后续的路线选择界面就能一直看到它（设计文档 6.5.2 的永久地图知识）。
 */
export function lockedNodeEvents(
  state: GameState,
  input: { mapId: Id; nodeId: Id; petIds: Id[] },
  catalog: Catalog = defaultCatalog,
): { eventId: Id; gate: GateStatus }[] {
  return nodeEventIds(input.nodeId, input.mapId, catalog)
    .map((eventId) => {
      const requirement = catalog.events[eventId]?.requiredSecondary;
      if (!requirement) return undefined;
      const gate = checkSecondaryRequirement(state, input.petIds, requirement);
      return gate.met ? undefined : { eventId, gate };
    })
    .filter((entry): entry is { eventId: Id; gate: GateStatus } =>
      Boolean(entry),
    );
}

function drawEvent(
  state: GameState,
  expedition: Expedition,
  catalog: Catalog,
): { eventId: string; seed: number } {
  const node = catalog.maps[expedition.mapId].nodes[expedition.targetNodeId];
  // 次要属性不达标的事件不参与抽取。副作用是属性低时可用事件更少、重复率更高，
  // 这一点在设计文档 6.5.2 里记着，靠内容侧保证低门槛事件的数量。
  const candidates = nodeEventIds(
    expedition.targetNodeId,
    expedition.mapId,
    catalog,
  ).filter((eventId) => {
    const requirement = catalog.events[eventId]?.requiredSecondary;
    return (
      !requirement ||
      checkSecondaryRequirement(state, expedition.petIds, requirement).met
    );
  });
  const notDrawn = candidates.filter(
    (eventId) => !expedition.drawnEventIds.includes(eventId),
  );
  const pool = notDrawn.length ? notDrawn : candidates;
  if (!pool.length) throw new GameRuleError(`节点 ${node.id} 没有可用事件。`);
  const random = nextRandom(expedition.currentSeed);
  const index = Math.min(pool.length - 1, Math.floor(random.value * pool.length));
  return { eventId: pool[index], seed: random.seed };
}

export function tick(
  source: GameState,
  now = Date.now(),
  catalog: Catalog = defaultCatalog,
): GameState {
  const state = clone(source);

  // 伤势恢复只在基地流逝，用绝对时间推进，所以关掉页面回来也会自动变好。
  for (const pet of Object.values(state.pets)) {
    if (advanceRecovery(pet, now)) {
      addLog(
        state,
        pet.injury === "healthy"
          ? `${pet.name}已经完全恢复。`
          : `${pet.name}的伤势好转为${INJURY_LABELS[pet.injury]}。`,
        now,
      );
    }
  }

  for (const expedition of state.expeditions) {
    if (expedition.phase !== "traveling" || expedition.arriveAt > now) continue;
    const map = catalog.maps[expedition.mapId];
    const node = map.nodes[expedition.targetNodeId];

    if (expedition.travelingFromNodeId && expedition.travelingEdgeId) {
      const fromNode = map.nodes[expedition.travelingFromNodeId];
      const traversedEdge = fromNode?.edges.find(
        (edge) => edge.id === expedition.travelingEdgeId,
      );
      if (traversedEdge?.hidden) {
        state.discoveredRouteKeys ??= [];
        const key = routeDiscoveryKey(
          map.id,
          expedition.travelingFromNodeId,
          expedition.travelingEdgeId,
        );
        if (!state.discoveredRouteKeys.includes(key)) {
          state.discoveredRouteKeys.push(key);
        }
      }
      expedition.travelingFromNodeId = undefined;
      expedition.travelingEdgeId = undefined;
    }

    // 起始节点只是地图入口：不计探索节点、不生成战利品或事件，抵达后直接选路线。
    // startNodeId 是唯一判据，因此策划无需再维护一组容易配错的开关字段。
    if (node.id === map.startNodeId && expedition.completedNodeCount === 0) {
      expedition.currentNodeId = node.id;
      expedition.currentEventId = undefined;
      expedition.arrivalLoot = {};
      if (!expedition.visitedNodeIds.includes(node.id)) {
        expedition.visitedNodeIds.push(node.id);
      }
      expedition.phase = "awaiting-route";
      if (!state.discoveredNodeIds.includes(node.id)) {
        state.discoveredNodeIds.push(node.id);
      }
      addLog(state, `队伍抵达${node.name}，正在等待选择探索路线。`, now);
      continue;
    }

    if (!node.loot) {
      throw new GameRuleError(`探索节点 ${node.id} 没有配置战利品掉落。`);
    }
    const lootDraw = drawNodeLoot(node.loot, expedition.currentSeed, catalog);
    expedition.currentSeed = lootDraw.seed;
    expedition.arrivalLoot = lootDraw.loot;
    expedition.pendingLoot = Object.keys(lootDraw.loot).length ? clone(lootDraw.loot) : undefined;
    expedition.currentNodeId = expedition.targetNodeId;
    expedition.visitedNodeIds.push(expedition.targetNodeId);
    expedition.completedNodeCount += 1;
    if (!state.discoveredNodeIds.includes(expedition.targetNodeId)) {
      state.discoveredNodeIds.push(expedition.targetNodeId);
    }
    if (node.terminal && !state.reachedEndpointIds.includes(node.id)) {
      state.reachedEndpointIds.push(node.id);
    }
    const lootCount = Object.values(lootDraw.loot).reduce(
      (sum, quantity) => sum + quantity,
      0,
    );
    if (!(node.eventPoolIds?.length)) {
      expedition.currentEventId = undefined;
      expedition.phase = node.terminal ? "extraction" : "awaiting-route";
      addLog(
        state,
        `队伍抵达${node.name}，发现 ${lootCount} 件战利品，本节点没有随机事件，${
          lootCount ? "正在等待拾取战利品" : node.terminal ? "正在准备撤离" : "正在等待选择路线"
        }。`,
        now,
      );
      continue;
    }

    const draw = drawEvent(state, expedition, catalog);
    expedition.currentEventId = draw.eventId;
    expedition.currentSeed = draw.seed;
    expedition.drawnEventIds.push(draw.eventId);
    expedition.phase = "awaiting-event";
    addLog(
      state,
      `队伍抵达${node.name}，发现 ${lootCount} 件战利品，${lootCount ? "正在等待拾取战利品，随后处理事件" : "正在等待处理事件"}。`,
      now,
    );
  }
  return state;
}

function requireLootFinished(expedition: Expedition): void {
  if (expedition.pendingLoot !== undefined) throw new GameRuleError("请先完成本节点的战利品拾取。");
}

/** 单件或整格拾取都受格子硬上限约束，重量只影响后续风险。 */
export function pickupNodeLoot(source: GameState, expeditionId: string, itemId: string, quantity = 1, now = Date.now(), catalog: Catalog = defaultCatalog): GameState {
  const state = clone(source), expedition = requireExpedition(state, expeditionId);
  if (expedition.phase === "traveling" || expedition.pendingLoot === undefined) throw new GameRuleError("当前没有可拾取的战利品。");
  if (!catalog.items[itemId] || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > (expedition.pendingLoot[itemId] ?? 0)) throw new GameRuleError("拾取数量无效，战利品可能已变化。");
  const cargo = addInventory(expedition.cargo, { [itemId]: quantity });
  if (inventorySlots(cargo, catalog) > cargoSlotCapacity(state, expedition, catalog)) throw new GameRuleError("背包格子已满，装不下这些战利品。");
  expedition.pendingLoot = removeInventory(expedition.pendingLoot, { [itemId]: quantity });
  expedition.cargo = cargo;
  recordItemAcquisitions(state, { [itemId]: quantity });
  addLog(state, `拾取了 ${quantity} 个${catalog.items[itemId].name}。`, now);
  return state;
}

export function pickupAllNodeLoot(source: GameState, expeditionId: string, now = Date.now(), catalog: Catalog = defaultCatalog): GameState {
  let state = source;
  const expedition = requireExpedition(source, expeditionId);
  if (expedition.pendingLoot === undefined || expedition.phase === "traveling") throw new GameRuleError("当前没有可拾取的战利品。");
  for (const [id, quantity] of Object.entries(expedition.pendingLoot)) {
    const current = requireExpedition(state, expeditionId), stack = itemStackSize(id, catalog);
    const held = current.cargo[id] ?? 0;
    const room = (held % stack ? stack - held % stack : 0) + Math.max(0, cargoSlotCapacity(state, current, catalog) - inventorySlots(current.cargo, catalog)) * stack;
    const take = Math.min(quantity, room);
    if (take) state = pickupNodeLoot(state, expeditionId, id, take, now, catalog);
  }
  return state;
}

export function finishNodeLoot(source: GameState, expeditionId: string, discardRemaining = false, now = Date.now()): GameState {
  const state = clone(source), expedition = requireExpedition(state, expeditionId);
  if (expedition.pendingLoot === undefined || expedition.phase === "traveling") throw new GameRuleError("当前没有等待完成的拾取。");
  const count = Object.values(expedition.pendingLoot).reduce((sum, q) => sum + q, 0);
  if (count && !discardRemaining) throw new GameRuleError("还有未拾取的战利品，请确认丢弃后继续。");
  if (count) addLog(state, `队伍放弃了 ${count} 件未拾取的战利品。`, now);
  expedition.pendingLoot = undefined;
  return state;
}

export function isChoiceAvailable(
  state: GameState,
  expedition: Expedition,
  choice: EventChoiceDefinition,
): { available: boolean; reason?: string } {
  const resolution = choiceResolution(choice);
  if (resolution.type === "leave") return { available: true };
  if (choice.requiredTagId && !teamHasTag(state, expedition, choice.requiredTagId)) {
    return { available: false, reason: "队伍缺少所需 Tag" };
  }
  if (choice.requiredSecondary) {
    const gate = checkSecondaryRequirement(
      state,
      expedition.petIds,
      choice.requiredSecondary,
    );
    if (!gate.met) return { available: false, reason: gate.label };
  }
  if (resolution.type === "secondary") {
    const gate = checkSecondaryRequirement(state, expedition.petIds, {
      stat: resolution.stat,
      value: resolution.successThreshold,
    });
    if (!gate.met) return { available: false, reason: gate.label };
  }
  return { available: true };
}

function worsenInjury(pet: Pet, steps = 1): void {
  const index = INJURY_ORDER.indexOf(pet.injury);
  pet.injury = INJURY_ORDER[Math.min(INJURY_ORDER.length - 1, index + steps)];
}

// 回到基地后开始（或重新开始）计时。健康的宠物不需要计时器。
function beginRecovery(pet: Pet, now: number): void {
  if (pet.injury === "healthy") {
    delete pet.injuryRecoveredAt;
    return;
  }
  pet.injuryRecoveredAt = now + INJURY_RECOVERY_MS[pet.injury];
}

// 一档一档往回走：失能先变受伤，再变正常，每档各自计时。
function advanceRecovery(pet: Pet, now: number): boolean {
  let changed = false;
  while (
    pet.injury !== "healthy" &&
    pet.injuryRecoveredAt !== undefined &&
    pet.injuryRecoveredAt <= now
  ) {
    const finishedAt = pet.injuryRecoveredAt;
    const index = INJURY_ORDER.indexOf(pet.injury);
    pet.injury = INJURY_ORDER[Math.max(0, index - 1)];
    changed = true;
    if (pet.injury === "healthy") {
      delete pet.injuryRecoveredAt;
    } else {
      // 从上一档结束的那一刻接着算，这样长时间离线能连着恢复好几档。
      pet.injuryRecoveredAt = finishedAt + INJURY_RECOVERY_MS[pet.injury];
    }
  }
  return changed;
}

export function injuryHealCost(pet: Pet): number {
  return INJURY_HEAL_COST[pet.injury];
}

export function healPet(
  source: GameState,
  petId: string,
  now = Date.now(),
): GameState {
  const state = clone(source);
  const pet = state.pets[petId];
  if (!pet) throw new GameRuleError("宠物不存在。");
  if (pet.injury === "healthy") throw new GameRuleError("这只宠物没有受伤。");
  if (state.expeditions.some((entry) => entry.petIds.includes(petId))) {
    throw new GameRuleError("宠物正在冒险途中，无法接受治疗。");
  }
  const cost = injuryHealCost(pet);
  if (state.currency < cost) throw new GameRuleError("通用货币不足。");
  state.currency -= cost;
  pet.injury = "healthy";
  delete pet.injuryRecoveredAt;
  addLog(state, `花费 ${cost} 通用货币治好了${pet.name}的伤。`, now);
  return state;
}

function injureRandomPet(
  state: GameState,
  expedition: Expedition,
  steps: number,
): string {
  const candidates = expedition.petIds.filter(
    (petId) => state.pets[petId].injury !== "incapacitated",
  );
  if (!candidates.length) return "";
  const random = nextRandom(expedition.currentSeed);
  expedition.currentSeed = random.seed;
  const petId = candidates[Math.floor(random.value * candidates.length)];
  worsenInjury(state.pets[petId], steps);
  return state.pets[petId].name;
}

function recordItemAcquisitions(state: GameState, inventory: Inventory): void {
  state.itemAcquisitionCounts ??= {};
  for (const [itemId, quantity] of Object.entries(inventory)) {
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    state.itemAcquisitionCounts[itemId] =
      (state.itemAcquisitionCounts[itemId] ?? 0) + quantity;
    if (!state.discoveredItemIds.includes(itemId)) state.discoveredItemIds.push(itemId);
  }
}

// cargo 同 ID 的物品可能同时包含「出发带入」和「本轮新获得」。发生损失、
// 丢弃或出售时优先消耗新获得部分；超过后才同步减少 initialCargo 快照。
function consumeInitialCargo(
  expedition: Expedition,
  itemId: Id,
  quantity: number,
): number {
  const initial = expedition.initialCargo?.[itemId] ?? 0;
  const surplus = Math.max(0, (expedition.cargo[itemId] ?? 0) - initial);
  const consumed = Math.min(initial, Math.max(0, quantity - surplus));
  if (consumed > 0) {
    expedition.initialCargo[itemId] -= consumed;
    if (expedition.initialCargo[itemId] <= 0) delete expedition.initialCargo[itemId];
  }
  return consumed;
}

export function hasEventRollAdvantage(
  state: GameState,
  expedition: Expedition,
  catalog: Catalog = defaultCatalog,
): boolean {
  return expedition.petIds.some((petId) =>
    petTags(state.pets[petId]).some((tagId) => {
      const tag = catalog.tags[tagId];
      return (
        tag?.eventRollAdvantage === true ||
        // 兼容配置台里基于旧内置目录保存的草稿：旧“概率 +2”字段不再按
        // 数值叠加，而是统一迁移成一次、不叠加的优势骰。
        (typeof tag?.extraRewardChance === "number" &&
          tag.extraRewardChance > 0)
      );
    }),
  );
}

// 冒险结束的唯一出口：发经验、开始伤势恢复计时、留下一条只读战报。
// 战利品的去向由调用方决定（撤离入库 / 溃败全丢）。
function finishExpedition(
  state: GameState,
  expedition: Expedition,
  input: {
    outcome: Settlement["outcome"];
    cargo: Inventory;
    firstExtractionRewards?: Inventory;
    xpAward: number;
    summary: string;
  },
  now: number,
): void {
  expedition.petIds.forEach((petId) => {
    const pet = state.pets[petId];
    if (!pet) return;
    grantXp(pet, input.xpAward);
    beginRecovery(pet, now);
  });
  state.settlements.unshift({
    id: nextId(state, "settlement"),
    expeditionId: expedition.id,
    lastResolution: expedition.lastResolution ? clone(expedition.lastResolution) : undefined,
    createdAt: now,
    petIds: [...expedition.petIds],
    cargo: clone(input.cargo),
    ...(input.firstExtractionRewards &&
    Object.values(input.firstExtractionRewards).some((quantity) => quantity > 0)
      ? { firstExtractionRewards: clone(input.firstExtractionRewards) }
      : {}),
    xpAward: input.xpAward,
    outcome: input.outcome,
    summary: input.summary,
  });
  state.expeditions = state.expeditions.filter(
    (candidate) => candidate.id !== expedition.id,
  );
}

function finishDefeat(
  state: GameState,
  expedition: Expedition,
  summary: string,
  now: number,
  catalog: Catalog,
): void {
  // 溃败只给节点基础经验的一半，没有战利品经验——东西没带回来（文档 3.9）。
  const multiplier = mapXpMultiplier(expedition.mapId, catalog);
  finishExpedition(
    state,
    expedition,
    {
      outcome: "defeat",
      cargo: {},
      xpAward: Math.max(
        MIN_DEFEAT_XP,
        Math.round(
          expedition.completedNodeCount * NODE_XP * DEFEAT_XP_RATIO * multiplier,
        ),
      ),
      summary,
    },
    now,
  );
  addLog(state, summary, now);
}

export function resolveEvent(
  source: GameState,
  expeditionId: string,
  choiceId: string,
  now = Date.now(),
  catalog: Catalog = defaultCatalog,
): GameState {
  const state = clone(source);
  const expedition = requireExpedition(state, expeditionId);
  requireLootFinished(expedition);
  if (expedition.phase !== "awaiting-event") {
    throw new GameRuleError("当前没有等待处理的事件。");
  }
  const event = catalog.events[expedition.currentEventId ?? ""];
  const choice = event?.choices.find((candidate) => candidate.id === choiceId);
  if (!event || !choice) throw new GameRuleError("找不到事件选项。");
  const availability = isChoiceAvailable(state, expedition, choice);
  if (!availability.available) throw new GameRuleError(availability.reason ?? "选项不可用。");
  const resolution = choiceResolution(choice);
  let outcome: EventResolution["outcome"];
  let rolls: number[] = [];
  let check: EventResolution["check"];
  if (resolution.type === "leave") {
    outcome = "leave";
    check = { type: "leave" };
  } else if (resolution.type === "secondary") {
    const current = teamSecondaryStat(
      state,
      expedition.petIds,
      resolution.stat,
    );
    outcome = current >= resolution.extraSuccessThreshold
      ? "extra-success"
      : "success";
    check = { type: "secondary", value: current };
  } else {
    const firstRandom = nextRandom(expedition.currentSeed);
    expedition.currentSeed = firstRandom.seed;
    rolls = [1 + Math.floor(firstRandom.value * 6)];
    if (hasEventRollAdvantage(state, expedition, catalog)) {
      const secondRandom = nextRandom(expedition.currentSeed);
      expedition.currentSeed = secondRandom.seed;
      rolls.push(1 + Math.floor(secondRandom.value * 6));
    }
    const roll = Math.max(...rolls);
    const score = riskScore(state, expedition, choice, catalog);
    check = { type: "primary", rolls: [...rolls], risk: score };
    outcome = primaryOutcomeForRoll(roll, score);
  }

  let reward: Inventory = {};
  let summary = "";
  if (outcome === "leave") {
    summary = "队伍没有介入，默默离开了现场。";
  } else if (outcome === "extra-success") {
    reward = addInventory(choice.rewards, choice.bonusRewards ?? {});
    summary = "队伍顺利完成处理，并获得了额外收获。";
  } else if (outcome === "success") {
    reward = clone(choice.rewards);
    summary = "队伍顺利完成处理。";
  } else if (outcome === "failure") {
    summary = "目标未能完成，但没有发生其他损失。";
  } else {
    const petName = injureRandomPet(state, expedition, 1);
    const canContinue = expedition.petIds.some(
      (petId) => state.pets[petId]?.injury !== "incapacitated",
    );
    summary = canContinue
      ? `发生大失败，${petName || "一名成员"}伤势加重，但队伍仍可继续行动。`
      : `发生大失败，${petName || "最后一名成员"}陷入失能，队伍已无人能够行动。`;
  }

  if (rolls.length === 2) {
    const roll = Math.max(...rolls);
    summary = `幸运儿掷出 ${rolls[0]}、${rolls[1]}，取较高的 ${roll}。${summary}`;
  }

  expedition.cargo = addInventory(expedition.cargo, reward);
  recordItemAcquisitions(state, reward);
  expedition.lastResolution = {
    eventId: event.id,
    choiceId: choice.id,
    outcome,
    title: event.title,
    summary,
    reward,
    check,
  };
  expedition.currentEventId = undefined;

  if (
    outcome === "big-failure" &&
    !expedition.petIds.some(
      (petId) => state.pets[petId]?.injury !== "incapacitated",
    )
  ) {
    finishDefeat(state, expedition, summary, now, catalog);
    return state;
  }

  const node =
    catalog.maps[expedition.mapId].nodes[expedition.currentNodeId ?? ""];
  expedition.phase = node.terminal ? "extraction" : "awaiting-route";
  addLog(state, `${event.title}：${summary}`, now);
  return state;
}

/**
 * 返回玩家当前能看见的路线。普通条件路线始终显示；hidden 路线只有队伍
 * 携带其 requirement.tagId 时显现；已经实际走过的隐藏路线也永久显示，
 * 但没有 Tag 时仍不可通行。该函数只管可见性，不代表已经可通行。
 */
export function getVisibleRoutes(
  state: GameState,
  expeditionId: string,
  catalog: Catalog = defaultCatalog,
): MapEdgeDefinition[] {
  const expedition = requireExpedition(state, expeditionId);
  const node =
    catalog.maps[expedition.mapId].nodes[expedition.currentNodeId ?? ""];
  if (!node) return [];
  return node.edges.filter(
    (edge) =>
      !edge.hidden ||
      isRouteDiscovered(state, expedition.mapId, node.id, edge.id) ||
      Boolean(
        edge.requirement?.tagId &&
          teamHasTag(state, expedition, edge.requirement.tagId),
      ),
  );
}

function routeRequirementMet(
  state: GameState,
  expedition: Expedition,
  edgeId: string,
  catalog: Catalog,
): { available: boolean; reason?: string } {
  const map = catalog.maps[expedition.mapId];
  const node = map.nodes[expedition.currentNodeId ?? ""];
  const edge = node.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return { available: false, reason: "路线不存在" };
  const requirement = edge.requirement;
  if (edge.hidden && !requirement?.tagId) {
    return { available: false, reason: "隐藏路线尚未显现" };
  }
  if (!requirement) return { available: true };
  if (requirement.tagId && !teamHasTag(state, expedition, requirement.tagId)) {
    const tagName = catalog.tags[requirement.tagId]?.name;
    return {
      available: false,
      reason: tagName ? `需要 Tag「${tagName}」` : "需要特定 Tag",
    };
  }
  if (requirement.minimumStat) {
    for (const [key, value] of Object.entries(requirement.minimumStat)) {
      const stat = key as StatKey;
      const current = teamStat(state, expedition, stat);
      if (current < (value ?? 0)) {
        // 门禁必须说清「差多少」，不能只说不足，也不能把英文字段名丢给玩家。
        return {
          available: false,
          reason: `需要${STAT_LABELS[stat] ?? stat} ${value}（当前 ${current}）`,
        };
      }
    }
  }
  if (requirement.secondary) {
    const gate = checkSecondaryRequirement(
      state,
      expedition.petIds,
      requirement.secondary,
    );
    if (!gate.met) return { available: false, reason: gate.label };
  }
  return { available: true };
}

export function getRouteAvailability(
  state: GameState,
  expeditionId: string,
  edgeId: string,
  catalog: Catalog = defaultCatalog,
): { available: boolean; reason?: string } {
  return routeRequirementMet(
    state,
    requireExpedition(state, expeditionId),
    edgeId,
    catalog,
  );
}

export function chooseRoute(
  source: GameState,
  expeditionId: string,
  edgeId: string,
  now = Date.now(),
  catalog: Catalog = defaultCatalog,
): GameState {
  const state = clone(source);
  const expedition = requireExpedition(state, expeditionId);
  requireLootFinished(expedition);
  if (expedition.phase !== "awaiting-route") {
    throw new GameRuleError("当前不能选择下一路线。");
  }
  // 格子超了就卡在原地：不扣收益、不加随机损失，只是必须先整理背包。
  if (isCargoOverSlots(state, expedition, catalog)) {
    throw new GameRuleError(
      `背包超出 ${
        cargoSlotsUsed(expedition, catalog) -
        cargoSlotCapacity(state, expedition, catalog)
      } 格，需要先丢弃部分战利品才能继续行动。`,
    );
  }
  const map = catalog.maps[expedition.mapId];
  const node = map.nodes[expedition.currentNodeId ?? ""];
  const edge = node.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) throw new GameRuleError("路线不存在。");
  const availability = routeRequirementMet(
    state,
    expedition,
    edgeId,
    catalog,
  );
  if (!availability.available) {
    throw new GameRuleError(availability.reason ?? "路线不可用。");
  }
  expedition.targetNodeId = edge.toNodeId;
  expedition.travelingFromNodeId = node.id;
  expedition.travelingEdgeId = edge.id;
  expedition.currentNodeId = undefined;
  expedition.phase = "traveling";
  expedition.arriveAt = now + edge.durationMs;
  expedition.arrivalLoot = {};
  expedition.lastResolution = undefined;
  addLog(state, `队伍选择“${edge.label}”，开始下一段行进。`, now);
  return state;
}

export function requestExtraction(
  source: GameState,
  expeditionId: string,
  now = Date.now(),
  catalog: Catalog = defaultCatalog,
): GameState {
  const state = clone(source);
  const expedition = requireExpedition(state, expeditionId);
  requireLootFinished(expedition);
  if (
    expedition.phase !== "awaiting-route" &&
    expedition.phase !== "extraction"
  ) {
    throw new GameRuleError("当前不能撤离。");
  }
  const map = catalog.maps[expedition.mapId];
  const node = map?.nodes[expedition.currentNodeId ?? ""];
  if (!node || expedition.currentNodeId === map.startNodeId || (!node.terminal && !node.extractable)) {
    throw new GameRuleError("当前节点不是撤离点，必须继续前往可撤离节点或地图终点。");
  }
  expedition.phase = "extraction";
  addLog(state, "队伍开始整理负重，准备立即撤离。", now);
  return state;
}

export function discardCargo(
  source: GameState,
  expeditionId: string,
  itemId: string,
  quantity = 1,
  now = Date.now(),
  catalog: Catalog = defaultCatalog,
): GameState {
  const state = clone(source);
  const expedition = requireExpedition(state, expeditionId);
  // 抵达后、事件结算后和撤离前都允许整理。节点掉落手动拾取，玩家也可以先
  // 丢弃重物腾出格子、降低本节点事件风险，再作选择。
  if (
    expedition.phase !== "extraction" &&
    expedition.phase !== "awaiting-route" &&
    expedition.phase !== "awaiting-event"
  ) {
    throw new GameRuleError("当前不能整理背包。");
  }
  consumeInitialCargo(expedition, itemId, quantity);
  expedition.cargo = removeInventory(expedition.cargo, {
    [itemId]: quantity,
  });
  addLog(state, `丢弃了 ${quantity} 个${catalog.items[itemId].name}。`, now);
  return state;
}

// 撤离整理时可以就地把战利品换成货币，这样仓库满了也有出路。
// 只开在 extraction 阶段：冒险途中能随时变现的话，负重取舍就没有意义了。
export function sellCargoItem(
  source: GameState,
  expeditionId: string,
  itemId: string,
  quantity = 1,
  now = Date.now(),
  catalog: Catalog = defaultCatalog,
): GameState {
  const state = clone(source);
  const expedition = requireExpedition(state, expeditionId);
  requireLootFinished(expedition);
  if (expedition.phase !== "extraction") {
    throw new GameRuleError("只有撤离整理时才能出售背包里的战利品。");
  }
  const item = catalog.items[itemId];
  if (!item?.sellable) throw new GameRuleError("该物品不可出售。");
  const value = item.sellValue ?? 0;
  const soldInitial = consumeInitialCargo(expedition, itemId, quantity);
  expedition.cargo = removeInventory(expedition.cargo, { [itemId]: quantity });
  // 记下来，撤离结算时它照样算战利品经验——判据是「成功带出来了」，
  // 而不是「最终躺在仓库里」。丢弃的走 discardCargo，不进这里。
  expedition.soldDuringExtraction = addInventory(
    expedition.soldDuringExtraction ?? {},
    { [itemId]: quantity },
  );
  expedition.soldInitialCargo = addInventory(
    expedition.soldInitialCargo ?? {},
    soldInitial > 0 ? { [itemId]: soldInitial } : {},
  );
  state.currency += value * quantity;
  addLog(
    state,
    `撤离前出售了 ${quantity} 个${catalog.items[itemId].name}，获得 ${
      value * quantity
    } 通用货币。`,
    now,
  );
  return state;
}

export function confirmExtraction(
  source: GameState,
  expeditionId: string,
  now = Date.now(),
  catalog: Catalog = defaultCatalog,
): GameState {
  const state = clone(source);
  const expedition = requireExpedition(state, expeditionId);
  requireLootFinished(expedition);
  if (expedition.phase !== "extraction") {
    throw new GameRuleError("当前不能确认撤离。");
  }
  // 超载只增加冒险事件风险；撤离不检查负重或背包格数，
  // 仅按最终入库（含首次奖励）合并后的仓库格数检查容量。
  const firstExtractionRewards = pendingFirstExtractionRewards(
    state,
    expedition,
    catalog,
  );
  const allIncoming = addInventory(expedition.cargo, firstExtractionRewards);
  // 按合并后算：背包里的东西能堆进仓库已有的同种物品，不一定要新占格子。
  // 首通奖励在成功撤离这一刻直接发放，不占冒险背包，但仍必须有仓库空间。
  const merged = addInventory(state.inventory, allIncoming);
  const neededSlots = inventorySlots(merged, catalog);
  if (neededSlots > state.warehouseSlots) {
    throw new GameRuleError(
      `仓库放不下，还差 ${neededSlots - state.warehouseSlots} 格。可以丢弃或出售部分战利品，也可以先卖掉仓库里的东西腾出格子。`,
    );
  }

  const carried = clone(expedition.cargo);
  const earnedCarried = removeInventory(
    carried,
    expedition.initialCargo ?? {},
  );
  const earnedSold = removeInventory(
    expedition.soldDuringExtraction ?? {},
    expedition.soldInitialCargo ?? {},
  );
  state.inventory = merged;
  recordItemAcquisitions(state, firstExtractionRewards);
  state.completedExtractionNodeKeys ??= [];
  const extractionKey =
    expedition.currentNodeId &&
    expedition.currentNodeId !== catalog.maps[expedition.mapId]?.startNodeId
      ? `${expedition.mapId}:${expedition.currentNodeId}`
      : undefined;
  if (
    extractionKey &&
    !state.completedExtractionNodeKeys.includes(extractionKey)
  ) {
    state.completedExtractionNodeKeys.push(extractionKey);
  }

  // 战利品经验按「成功带出来的东西」算：入库的算，撤离时就地卖掉的也算，
  // 丢弃的不算。节点经验和战利品经验都要乘地图经验系数。
  const multiplier = mapXpMultiplier(expedition.mapId, catalog);
  const nodeXp = expedition.completedNodeCount * NODE_XP;
  const haulXp =
    lootXp(earnedCarried, catalog) +
    lootXp(firstExtractionRewards, catalog) +
    lootXp(earnedSold, catalog);
  const xpAward = Math.round((nodeXp + haulXp) * multiplier);

  finishExpedition(
    state,
    expedition,
    {
      outcome: "success",
      cargo: carried,
      firstExtractionRewards,
      xpAward,
      summary: `成功撤离，带回 ${Object.values(carried).reduce(
        (sum, value) => sum + value,
        0,
      )} 件物品${Object.keys(firstExtractionRewards).length ? `，并领取 ${Object.values(firstExtractionRewards).reduce((sum, value) => sum + value, 0)} 件该撤离点的首次奖励` : ""}。`,
    },
    now,
  );
  addLog(
    state,
    Object.keys(firstExtractionRewards).length
      ? "队伍完成撤离，战利品与该撤离点的首次奖励已直接入库。"
      : "队伍完成撤离，战利品已直接入库。",
    now,
  );
  return state;
}

/** 本轮背包的三种互斥去向；不能把仓库旧物品混入其中。 */
export interface ExtractionPlan {
  keep: Inventory;
  sell: Inventory;
  discard: Inventory;
}

/** 所有背包物品必须明确归入一种去向；任何校验失败都不修改源存档。 */
export function confirmExtractionPlan(
  source: GameState,
  expeditionId: string,
  plan: ExtractionPlan,
  now = Date.now(),
  catalog: Catalog = defaultCatalog,
): GameState {
  const expedition = requireExpedition(source, expeditionId);
  requireLootFinished(expedition);
  if (expedition.phase !== "extraction") throw new GameRuleError("当前不能确认撤离。");
  const total: Inventory = {};
  for (const group of [plan.keep, plan.sell, plan.discard]) {
    for (const [id, quantity] of Object.entries(group)) {
      if (!catalog.items[id] || !Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new GameRuleError("撤离清单包含无效物品或数量。");
      }
      total[id] = (total[id] ?? 0) + quantity;
    }
  }
  for (const id of new Set([...Object.keys(total), ...Object.keys(expedition.cargo)])) {
    if ((total[id] ?? 0) !== (expedition.cargo[id] ?? 0)) {
      throw new GameRuleError("背包已变化，请重新整理撤离清单。");
    }
  }
  let next = source;
  for (const [id, quantity] of Object.entries(plan.discard)) next = discardCargo(next, expeditionId, id, quantity, now, catalog);
  for (const [id, quantity] of Object.entries(plan.sell)) next = sellCargoItem(next, expeditionId, id, quantity, now, catalog);
  const revenue = next.currency - source.currency;
  next = confirmExtraction(next, expeditionId, now, catalog);
  const report = next.settlements[0];
  report.soldCargo = clone(plan.sell);
  report.saleRevenue = revenue;
  return next;
}

/**
 * 返回本次成功撤离将领取的节点首次奖励。只有显式撤离点和固定终点有效；
 * 起始入口与普通探索节点不算。只负责预览，不修改状态。
 */
export function pendingFirstExtractionRewards(
  state: GameState,
  expedition: Expedition,
  catalog: Catalog = defaultCatalog,
): Inventory {
  const map = catalog.maps[expedition.mapId];
  const nodeId = expedition.currentNodeId;
  if (!map || !nodeId || nodeId === map.startNodeId) return {};
  const node = map.nodes[nodeId];
  if (!node || (!node.terminal && !node.extractable)) return {};
  const extractionKey = `${expedition.mapId}:${nodeId}`;
  if ((state.completedExtractionNodeKeys ?? []).includes(extractionKey)) return {};
  return clone(node.firstExtractionRewards ?? {});
}

export function warehouseSlotsUsed(
  state: GameState,
  catalog: Catalog = defaultCatalog,
): number {
  return inventorySlots(state.inventory, catalog);
}

// 战报是只读的，关掉就行，不存在“还有东西没处理”这种阻塞。
export function dismissSettlement(
  source: GameState,
  settlementId: string,
): GameState {
  const state = clone(source);
  if (!state.settlements.some(({ id }) => id === settlementId)) {
    throw new GameRuleError("找不到这条战报。");
  }
  state.settlements = state.settlements.filter(
    (candidate) => candidate.id !== settlementId,
  );
  return state;
}

export function sellWarehouseItem(
  source: GameState,
  itemId: string,
  quantity = 1,
  catalog: Catalog = defaultCatalog,
): GameState {
  return sellWarehouseItems(source, { [itemId]: quantity }, catalog);
}

/** Preflight every line before committing a batch; never partially sell a selection. */
export function sellWarehouseItems(
  source: GameState,
  quantities: Inventory,
  catalog: Catalog = defaultCatalog,
): GameState {
  const entries = Object.entries(quantities);
  if (!entries.length) throw new GameRuleError("请先选择要出售的物品。");
  let income = 0;
  for (const [itemId, quantity] of entries) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new GameRuleError("出售数量必须是正整数。");
    if (source.lockedItemIds.includes(itemId)) throw new GameRuleError("物品已锁定。");
    const item = Object.hasOwn(catalog.items, itemId) ? catalog.items[itemId] : undefined;
    if (!item?.sellable) throw new GameRuleError("该物品不可出售。");
    if ((source.inventory[itemId] ?? 0) < quantity) throw new GameRuleError(`物品不足：${item.name}`);
    income += (item.sellValue ?? 0) * quantity;
  }
  const state = clone(source);
  state.inventory = removeInventory(state.inventory, quantities);
  state.currency += income;
  return state;
}

export function toggleItemLock(
  source: GameState,
  itemId: string,
): GameState {
  const state = clone(source);
  state.lockedItemIds = state.lockedItemIds.includes(itemId)
    ? state.lockedItemIds.filter((id) => id !== itemId)
    : [...state.lockedItemIds, itemId];
  return state;
}

export function maxLevel(): number {
  return MAX_LEVEL;
}

/** 从 level 升到 level+1 需要的经验。满级后返回 0。 */
export function xpToNextLevel(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return Math.round(Math.pow(level, XP_CURVE_EXPONENT) * XP_CURVE_K);
}

function grantXp(pet: Pet, amount: number): void {
  if (pet.level >= MAX_LEVEL) return;
  pet.xp += amount;
  while (pet.level < MAX_LEVEL && pet.xp >= xpToNextLevel(pet.level)) {
    pet.xp -= xpToNextLevel(pet.level);
    pet.level += 1;
    pet.unspentPoints += POINTS_PER_LEVEL;
  }
  // 满级后不再累计，否则界面上会挂着一个永远用不掉的经验条。
  if (pet.level >= MAX_LEVEL) pet.xp = 0;
}

export function mapXpMultiplier(
  mapId: string,
  catalog: Catalog = defaultCatalog,
): number {
  const value = catalog.maps[mapId]?.xpMultiplier;
  return typeof value === "number" && value > 0 ? value : 1;
}

/** 战利品经验：按件数累加，白绿两档为 0。 */
export function lootXp(
  inventory: Inventory,
  catalog: Catalog = defaultCatalog,
): number {
  return Object.entries(inventory).reduce((total, [itemId, quantity]) => {
    if (quantity <= 0) return total;
    const rarity = catalog.items[itemId]?.rarity;
    return total + (rarity ? LOOT_XP_BY_RARITY[rarity] * quantity : 0);
  }, 0);
}

export function taskIsAvailable(
  state: GameState,
  taskId: string,
  catalog: Catalog = defaultCatalog,
): boolean {
  const task = catalog.tasks[taskId];
  if (!task || state.completedTaskIds.includes(taskId)) return false;
  return (task.prerequisiteTaskIds ?? []).every((id) =>
    state.completedTaskIds.includes(id),
  );
}

/** 记录一次性玩家行为。重复上报返回原状态，不写日志也不制造重复记录。 */
export function recordMilestone(
  source: GameState,
  milestoneId: PlayerMilestoneId,
): GameState {
  if (!isPlayerMilestoneId(milestoneId)) {
    throw new GameRuleError(`未知的玩家里程碑：${String(milestoneId)}`);
  }
  if ((source.completedMilestoneIds ?? []).includes(milestoneId)) return source;
  const state = clone(source);
  state.completedMilestoneIds = [
    ...(state.completedMilestoneIds ?? []),
    milestoneId,
  ];
  return state;
}

/**
 * 成功从地图任意固定终点撤离过一次即视为通关。中途撤离点虽然能撤离，
 * 但不会满足地图通关目标。
 */
export function mapIsCleared(
  state: GameState,
  mapId: string,
  catalog: Catalog = defaultCatalog,
): boolean {
  const map = catalog.maps[mapId];
  if (!map) return false;
  return Object.values(map.nodes).some(
    (node) =>
      node.terminal === true &&
      (state.completedExtractionNodeKeys ?? []).includes(`${mapId}:${node.id}`),
  );
}

export function taskCanComplete(
  state: GameState,
  taskId: string,
  catalog: Catalog = defaultCatalog,
): boolean {
  if (!taskIsAvailable(state, taskId, catalog)) return false;
  const requirement = catalog.tasks[taskId].requirement;
  const hasItems = Object.entries(requirement.items ?? {}).every(
    ([itemId, quantity]) => (state.inventory[itemId] ?? 0) >= quantity,
  );
  const hasCurrency = state.currency >= (requirement.currency ?? 0);
  const hasGoals = (requirement.goals ?? []).every((goal) => {
    if (goal.type === "clear-map") {
      return mapIsCleared(state, goal.mapId, catalog);
    }
    if (goal.type === "milestone") {
      return (state.completedMilestoneIds ?? []).includes(goal.milestoneId);
    }
    return false;
  });
  if (!hasItems || !hasCurrency || !hasGoals) return false;

  // 奖励物品直接入库。提交物品会先腾出格子，仓库扩容奖励也在同一次
  // 结算中生效，因此按最终状态判断，避免任务完成后把仓库挤爆。
  return taskRewardFitsWarehouse(state, taskId, catalog);
}

export function taskRewardFitsWarehouse(
  state: GameState,
  taskId: string,
  catalog: Catalog = defaultCatalog,
): boolean {
  const task = catalog.tasks[taskId];
  if (!task) return false;
  if (
    Object.entries(task.requirement.items ?? {}).some(
      ([itemId, quantity]) => (state.inventory[itemId] ?? 0) < quantity,
    )
  ) {
    // 资源条件未满足时先不显示“奖励放不下”；等玩家真的持有提交物后，
    // 才能准确计算提交腾出的格子。
    return true;
  }
  const inventoryAfterSubmission = removeInventory(
    state.inventory,
    task.requirement.items ?? {},
  );
  const inventoryAfterReward = addInventory(
    inventoryAfterSubmission,
    task.reward.items ?? {},
  );
  return (
    inventorySlots(inventoryAfterReward, catalog) <=
    state.warehouseSlots + (task.reward.warehouseSlots ?? 0)
  );
}

export function completeTask(
  source: GameState,
  taskId: string,
  now = Date.now(),
  catalog: Catalog = defaultCatalog,
): GameState {
  const state = clone(source);
  if (!taskCanComplete(state, taskId, catalog)) {
    throw new GameRuleError("任务条件尚未满足。");
  }
  const task = catalog.tasks[taskId];
  state.inventory = removeInventory(
    state.inventory,
    task.requirement.items ?? {},
  );
  state.currency -= task.requirement.currency ?? 0;
  state.completedTaskIds.push(taskId);
  state.currency += task.reward.currency ?? 0;
  for (const mapId of task.reward.unlockMapIds ?? []) {
    if (!state.unlockedMapIds.includes(mapId)) state.unlockedMapIds.push(mapId);
  }
  for (const petId of task.reward.addPetIds ?? []) {
    if (!state.pets[petId]) {
      state.pets[petId] = clonePetTemplate(catalog.petTemplates[petId]);
    }
  }
  state.inventory = addInventory(state.inventory, task.reward.items ?? {});
  recordItemAcquisitions(state, task.reward.items ?? {});
  state.warehouseSlots += task.reward.warehouseSlots ?? 0;
  addLog(state, `完成任务“${task.title}”。`, now);
  return state;
}

export function warehouseExpansionSlots(): number {
  return WAREHOUSE_EXPANSION_SLOTS;
}

export function warehouseExpansionCost(state: GameState): number {
  const expansions = Math.max(
    0,
    (state.warehouseSlots - INITIAL_WAREHOUSE_SLOTS) /
      WAREHOUSE_EXPANSION_SLOTS,
  );
  return 20 + expansions * 10;
}

export function expandWarehouse(source: GameState): GameState {
  const state = clone(source);
  const cost = warehouseExpansionCost(state);
  if (state.currency < cost) throw new GameRuleError("通用货币不足。");
  state.currency -= cost;
  state.warehouseSlots += WAREHOUSE_EXPANSION_SLOTS;
  return state;
}

export function allocateStat(
  source: GameState,
  petId: string,
  stat: StatKey,
): GameState {
  if (!Object.hasOwn(STAT_LABELS, stat)) throw new GameRuleError("未知主属性。");
  return allocateStats(source, petId, { fitness: 0, perception: 0, technique: 0, [stat]: 1 });
}

// 整份加点草稿一次校验、一次落库，不循环调用单点提交。
export function allocateStats(source: GameState, petId: string, points: Stats): GameState {
  const keys = Object.keys(STAT_LABELS) as StatKey[];
  if (!points || Object.keys(points).length !== keys.length ||
      keys.some(key => !Number.isSafeInteger(points[key]) || points[key] < 0)) {
    throw new GameRuleError("属性点方案必须包含三项非负整数。");
  }
  const total = keys.reduce((sum, key) => sum + points[key], 0);
  const state = clone(source);
  const pet = state.pets[petId];
  if (!pet) throw new GameRuleError("宠物不存在。");
  if (total <= 0) throw new GameRuleError("没有待确认的属性点。");
  if (!Number.isSafeInteger(total) || total > pet.unspentPoints) throw new GameRuleError("未分配属性点不足。");
  pet.unspentPoints -= total;
  for (const key of keys) pet.allocatedStats[key] += points[key];
  return state;
}

export function petStatResetCost(state: GameState): number {
  return [0, 500, 2_000, 10_000, 30_000][Math.min(state.statResetCount ?? 0, 4)];
}

export function resetPetStats(source: GameState, petId: string, expectedResetCount?: number): GameState {
  const state = clone(source);
  const pet = state.pets[petId];
  if (!pet) throw new GameRuleError("宠物不存在。");
  const count = state.statResetCount ?? 0;
  if (expectedResetCount !== undefined && count !== expectedResetCount) {
    throw new GameRuleError("洗点费用已变化，请重新确认。");
  }
  const refunded =
    pet.allocatedStats.fitness +
    pet.allocatedStats.perception +
    pet.allocatedStats.technique;
  if (refunded <= 0) throw new GameRuleError("没有已分配的属性点。");
  const cost = petStatResetCost(state);
  if (state.currency < cost) throw new GameRuleError("通用货币不足。");
  state.currency -= cost;
  state.statResetCount = count + 1;
  pet.unspentPoints += refunded;
  pet.allocatedStats = { fitness: 0, perception: 0, technique: 0 };
  addLog(state, `${pet.name}花费 ${cost} 通用货币重置了 ${refunded} 点属性。`);
  return state;
}

export function applyTagItem(
  source: GameState,
  petId: string,
  itemId: string,
  catalog: Catalog = defaultCatalog,
): GameState {
  const state = clone(source);
  const pet = state.pets[petId];
  const item = catalog.items[itemId];
  const tagId = item?.tagGrantId;
  if (!pet || !tagId) throw new GameRuleError("无法使用该成长道具。");
  if ((state.inventory[itemId] ?? 0) <= 0) {
    throw new GameRuleError("仓库中没有该成长道具。");
  }
  if (pet.growthTagIds.length >= pet.growthTagSlots) {
    throw new GameRuleError("宠物的可塑造 Tag 槽已满。");
  }
  if (petTags(pet).includes(tagId)) {
    throw new GameRuleError("宠物已经拥有相同 Tag。");
  }
  state.inventory = removeInventory(state.inventory, { [itemId]: 1 });
  pet.growthTagIds.push(tagId);
  return state;
}

export function secondaryStatCap(): number {
  return SECONDARY_STAT_CAP;
}

export function applySecondaryGrantItem(
  source: GameState,
  petId: string,
  itemId: string,
  now = Date.now(),
  catalog: Catalog = defaultCatalog,
): GameState {
  const state = clone(source);
  const pet = state.pets[petId];
  const grant = catalog.items[itemId]?.secondaryGrant;
  if (!pet || !grant) throw new GameRuleError("无法使用该成长道具。");
  if ((state.inventory[itemId] ?? 0) <= 0) {
    throw new GameRuleError("仓库中没有该成长道具。");
  }
  const name = SECONDARY_STAT_LABELS[grant.stat];
  const current = petSecondaryStat(pet, grant.stat);
  if (current >= SECONDARY_STAT_CAP) {
    throw new GameRuleError(
      `${pet.name}的${name}已经达到上限 ${SECONDARY_STAT_CAP}。`,
    );
  }
  // 超出上限的部分直接截断，道具照常消耗——玩家看得到上限，是否浪费由他决定。
  const next = Math.min(SECONDARY_STAT_CAP, current + grant.amount);
  state.inventory = removeInventory(state.inventory, { [itemId]: 1 });
  pet.secondaryStats = { ...pet.secondaryStats, [grant.stat]: next };
  addLog(
    state,
    `${pet.name}使用${catalog.items[itemId].name}，${name} ${current} → ${next}。`,
    now,
  );
  return state;
}

export function routeRequirementLabel(
  state: GameState,
  expedition: Expedition,
  edgeId: string,
  catalog: Catalog = defaultCatalog,
): string | undefined {
  return routeRequirementMet(state, expedition, edgeId, catalog).reason;
}
