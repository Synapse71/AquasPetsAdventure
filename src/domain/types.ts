import type { Rarity } from "./rarity";
import type { PlayerMilestoneId } from "./milestones";

export type Id = string;
export type StatKey = "fitness" | "perception" | "technique";

// 次要属性：回答「这只宠物能进哪扇门」，与三项主属性正交。
// 与主属性的区别见设计文档 6.5.1：硬门槛、不进风险公式、队内取最高、不受伤势影响。
export type SecondaryStatKey = "eloquence" | "lore" | "courage" | "guile";
export type SecondaryStats = Record<SecondaryStatKey, number>;
export type InjuryStage = "healthy" | "injured" | "incapacitated";
export type RiskBand = "稳妥" | "冒险" | "危险" | "极其危险";
export type Inventory = Record<Id, number>;

export interface Stats {
  fitness: number;
  perception: number;
  technique: number;
}

// 门禁只对应一项次要属性。用单个对象而不是 Partial<SecondaryStats>，
// 是为了让「一个门禁不得同时要求两项」这条规则在类型上就无法违反
// （设计文档 6.5.2 / 不变量 17）。
export interface SecondaryRequirement {
  stat: SecondaryStatKey;
  value: number;
}

export interface Pet {
  id: Id;
  name: string;
  level: number;
  xp: number;
  unspentPoints: number;
  baseStats: Stats;
  allocatedStats: Stats;
  // 次要属性：每只宠物都拥有全部四项，只是初始值不同。
  // 不由属性点提升，只能靠专用成长道具，上限统一。
  secondaryStats: SecondaryStats;
  injury: InjuryStage;
  // 当前伤势档位恢复完成的时间戳。只在宠物待在基地时存在：
  // 出发会清掉它，回来才重新开始计时，所以冒险途中不会自愈。
  injuryRecoveredAt?: number;
  innateTagId?: Id;
  growthTagIds: Id[];
  growthTagSlots: number;
}

export interface ItemDefinition {
  id: Id;
  name: string;
  // 只有传说和神话档位需要描述。其余档位是随处可见的东西，名字本身已经说明一切。
  description?: string;
  // 获取难度档位。与重量无关，与掉落稀有度和值重比大致正相关，允许单件例外。
  rarity: Rarity;
  weight: number;
  // 每格能堆多少个。省略即为 1，也就是一件占一格。
  // 想让某件碎料堆起来就显式写一个数，不从重量或稀有度推导。
  stackSize?: number;
  // 是否可出售，必填。不能用「有没有 sellValue」来表达——那样漏填价格和
  // 刻意设成不可卖在数据上分不出来（设计文档不变量 14）。
  sellable: boolean;
  // 只有 sellable 为 true 时才有意义，配置校验会保证两者一致。
  sellValue?: number;
  // 物品分类标签，可有多个也可没有，例如 tool / food / collectible。
  // 与下面的 tagGrantId 不是一回事，见 itemTags.ts 顶部说明。
  tags?: string[];
  // 指向一个「宠物 Tag」：使用该物品会把那个 Tag 永久绑定给宠物。
  tagGrantId?: Id;
  // 次要属性成长道具：提升指定次要属性若干点。
  // 加成数值是显式字段，不由稀有度推导（同 10.1 的字段独立原则）。
  // 内容约定是史诗 +1、传说 +3，但那只是内容安排，规则层不做这个耦合。
  secondaryGrant?: { stat: SecondaryStatKey; amount: number };
  // 吃掉后为本次远征提供的主属性加成（设计文档 9.3）。两个 food* 字段互相独立，
  // 一件物品可以只有其一、也可以都有；哪些食物配、配多少由配表决定，规则层不看稀有度。
  //
  // 刻意只允许一项主属性，而不是 Partial<Stats>：同时只存在一个食物 buff、后吃的顶掉
  // 前面的，所以玩家必须一眼比较新旧两个 buff。多项加成会让「顶掉」变成一次盲赌。
  //
  // 也刻意不提供次要属性加成：次要属性是硬门槛，食物能抬高门槛就等于食物是钥匙，
  // 那它立刻变回必需品（设计文档 9.3 不变量 1）。
  foodBuff?: { stat: StatKey; amount: number };
  // 吃掉后恢复的伤势档数。按档而不是一次治到底，和自然恢复同粒度。
  foodHeal?: { steps: number };
}

// Tag 不影响任何主属性：既不加负重、格子，也不整体降低风险。
// 那是主属性和次要属性的地盘，Tag 负责解锁隐藏内容和改变局部规则
// （设计文档 7.1）。这里刻意不保留 carryBonus / allRiskBonus 字段，
// 让「Tag 又变回数值加成」在类型上就写不出来。
export interface TagDefinition {
  id: Id;
  name: string;
  description: string;
  // 事件检定掷两次 D6 并取较高值。队伍内只判断有无，不按 Tag 数量叠加。
  eventRollAdvantage?: boolean;
  // 旧目录兼容字段：曾表示概率触发 +2；运行时会把正数迁移解释为优势骰。
  // 新内容不要再写这个字段。
  extraRewardChance?: number;
}

export interface RouteRequirement {
  tagId?: Id;
  minimumStat?: Partial<Stats>;
  secondary?: SecondaryRequirement;
}

export interface MapEdgeDefinition {
  id: Id;
  label: string;
  description: string;
  toNodeId: Id;
  durationMs: number;
  requirement?: RouteRequirement;
  hidden?: boolean;
}

export type RarityWeights = Partial<Record<Rarity, number>>;

export interface NodeLootPoolFilter {
  // ID 与物品分类 Tag 的白名单取并集；两类都为空时表示不限制候选物品。
  whitelistItemIds?: Id[];
  whitelistItemTags?: string[];
  // ID 与物品分类 Tag 的黑名单取并集，并始终在白名单之后排除。
  blacklistItemIds?: Id[];
  blacklistItemTags?: string[];
}

export interface IndependentNodeLootDefinition extends NodeLootPoolFilter {
  mode: "independent";
  minCount: number;
  maxCount: number;
  // 省略时 minCount～maxCount 等概率；配置后只抽取权重大于 0 的数量。
  countWeights?: Record<string, number>;
  // 每件战利品独立抽一次稀有度，权重会在运行时归一化。
  rarityWeights: RarityWeights;
}

export interface LootCompositionDefinition {
  id: Id;
  weight: number;
  // 抽中该组合后，严格按照这里的各档数量抽取物品。
  rarityCounts: Partial<Record<Rarity, number>>;
}

export interface CompositionNodeLootDefinition extends NodeLootPoolFilter {
  mode: "composition";
  minCount: number;
  maxCount: number;
  compositions: LootCompositionDefinition[];
}

// 每个节点只能二选一，不支持在同一节点叠加多个掉落组。
export type NodeLootDefinition =
  | IndependentNodeLootDefinition
  | CompositionNodeLootDefinition;

export interface MapNodeDefinition {
  id: Id;
  name: string;
  // 起始节点是无收益的路线入口，因此不配置 loot；所有非起始节点必填 loot。
  loot?: NodeLootDefinition;
  // 省略或为空表示本节点没有随机事件，结算战利品后直接选择路线或撤离。
  eventPoolIds?: Id[];
  edges: MapEdgeDefinition[];
  terminal?: boolean;
  // 非终点只有显式标记后才允许主动撤离；固定终点天然可撤离。
  extractable?: boolean;
  // 第一次从本节点成功撤离时发放一次。只允许中途撤离点和固定终点配置；
  // 普通探索节点与起始入口无效。
  firstExtractionRewards?: Inventory;
}

export interface MapDefinition {
  id: Id;
  number: number;
  name: string;
  description: string;
  startNodeId: Id;
  // 兼容旧目录字段；运行时固定 15 秒，策划读写会归一化为 15000。
  startDurationMs: number;
  // 选中队伍的有效感知达到 partial / full 时，地图预览分别进入第二 / 第三档。
  informationThresholds: {
    partial: number;
    full: number;
  };
  // 每完成一个非起始节点获得的基础经验。省略时兼容旧目录，按 10 计算。
  nodeXp?: number;
  nodes: Record<Id, MapNodeDefinition>;
}

export type EventChoiceResolution =
  | {
      type: "primary";
      stat: StatKey;
      difficulty: number;
    }
  | {
      type: "secondary";
      stat: SecondaryStatKey;
      successThreshold: number;
      extraSuccessThreshold: number;
    }
  | {
      type: "leave";
    };

export interface EventChoiceDefinition {
  id: Id;
  label: string;
  description: string;
  resolution?: EventChoiceResolution;
  // 兼容旧配置；新配置统一写入 resolution。
  stat?: StatKey;
  difficulty?: number;
  rewards: Inventory;
  bonusRewards?: Inventory;
  requiredTagId?: Id;
  // 兼容旧配置中的额外门槛；新次要属性选项改用 secondary resolution。
  requiredSecondary?: SecondaryRequirement;
}

export interface EventDefinition {
  id: Id;
  title: string;
  description: string;
  choices: EventChoiceDefinition[];
  uniquePerRun?: boolean;
  // 不达标时整个事件不参与本节点抽取，改为在节点信息里列出所需属性与数值。
  requiredSecondary?: SecondaryRequirement;
}

export interface EventPoolDefinition {
  id: Id;
  eventIds: Id[];
}

export interface ClearMapTaskGoal {
  type: "clear-map";
  mapId: Id;
}

export interface MilestoneTaskGoal {
  type: "milestone";
  milestoneId: PlayerMilestoneId;
}

export type TaskGoalDefinition = ClearMapTaskGoal | MilestoneTaskGoal;

export interface TaskRequirement {
  items?: Inventory;
  // 提交任务时实际扣除。与物品、目标条件同时存在时采用 AND。
  currency?: number;
  goals?: TaskGoalDefinition[];
}

export interface TaskReward {
  currency?: number;
  unlockMapIds?: Id[];
  addPetIds?: Id[];
  items?: Inventory;
  warehouseSlots?: number;
}

export interface TaskDefinition {
  id: Id;
  title: string;
  description: string;
  requirement: TaskRequirement;
  reward: TaskReward;
  prerequisiteTaskIds?: Id[];
}

export interface StartExpeditionInput {
  mapId: Id;
  petIds: Id[];
  // 从仓库带入本轮背包；出发时原子扣除。省略表示空背包出发。
  cargo?: Inventory;
  // 行前整备选定的食物，出发时和 cargo 一起从仓库原子扣除，把加成快照写进新远征。
  // 「选定」而不是「立刻吃掉」：玩家反悔或退回上一步，食物都还在仓库里。
  foodItemId?: Id;
}

export type ExpeditionPhase =
  | "traveling"
  | "awaiting-event"
  | "awaiting-route"
  | "extraction";

export interface EventResolution {
  eventId: Id;
  choiceId: Id;
  outcome:
    | "extra-success"
    | "success"
    | "failure"
    | "big-failure"
    | "leave";
  title: string;
  summary: string;
  reward: Inventory;
  // 已提交的真实检定记录。UI 动画只读取，关闭/重启不能重新掷骰。
  check?: { type: "primary"; rolls: number[]; risk: number } | { type: "secondary"; value: number } | { type: "leave" };
}

export interface Expedition {
  id: Id;
  mapId: Id;
  petIds: Id[];
  phase: ExpeditionPhase;
  targetNodeId: Id;
  currentNodeId?: Id;
  // 只在路线行进途中保留，用于抵达后登记「确实走过」的隐藏路线。
  travelingFromNodeId?: Id;
  travelingEdgeId?: Id;
  startedAt: number;
  arriveAt: number;
  cargo: Inventory;
  // 出发时从仓库带入的、当前仍留在背包中的数量。它不受保护，
  // 只用于避免把重复带回的旧物品再次计算为战利品经验。
  initialCargo: Inventory;
  // 最近一次抵达生成的完整掉落快照；开箱演出只读，不重新抽取。
  arrivalLoot: Inventory;
  // 当前生效的食物 buff，整趟有效，随远征一起销毁——所以不需要任何计时器。
  // 同时只有一个，后吃的直接覆盖。
  //
  // 加成是**吃下那一刻的快照**，不回目录重算：配置台可以在远征途中改数值甚至删物品
  // （已发布目录会整个替换 catalog），回查会让在途冒险的容量当场缩水，进而超格、
  // 逼玩家丢弃已经捡到的战利品。itemId 只用于显示名字，不参与任何计算。
  foodBuff?: { itemId: Id; stat: StatKey; amount: number };
  // 存在时必须先完成拾取；空对象表示已拾完、尚未点击继续。
  // 旧存档没有此字段，其 arrivalLoot 已入包，绝不能再次发放。
  pendingLoot?: Inventory;
  // 撤离整理时就地卖掉的东西。它们照样算战利品经验——「成功带出来了」才是
  // 判据，卖掉只是换了种变现方式；丢弃的不进这里，所以不算。
  soldDuringExtraction: Inventory;
  // soldDuringExtraction 中原本来自初始携带的部分，同样不计战利品经验。
  soldInitialCargo: Inventory;
  visitedNodeIds: Id[];
  drawnEventIds: Id[];
  currentEventId?: Id;
  currentSeed: number;
  completedNodeCount: number;
  lastResolution?: EventResolution;
}

// 冒险结束后的一条只读战报。战利品在撤离确认时就已经直接进了仓库，
// 经验和伤势恢复计时也在那一刻结算完毕，所以这里没有任何待办操作，
// 玩家看完关掉即可，宠物不会因为它还挂在列表里就无法出勤。
export interface Settlement {
  id: Id;
  expeditionId?: Id;
  lastResolution?: EventResolution;
  soldCargo?: Inventory;
  saleRevenue?: number;
  createdAt: number;
  petIds: Id[];
  // 本轮实际带回仓库的东西，仅用于展示。
  cargo: Inventory;
  // 本次结算额外发放的节点首次撤离奖励，仅用于单独展示。
  firstExtractionRewards?: Inventory;
  xpAward: number;
  outcome: "success" | "defeat";
  summary: string;
}

export interface GameLogEntry {
  id: Id;
  createdAt: number;
  message: string;
}

export interface GameState {
  version: number;
  currency: number;
  // 整个存档共用的成功洗点次数；旧存档补 0，不推断历史次数。
  statResetCount: number;
  // 仓库只限制格子数，不限制重量。
  warehouseSlots: number;
  inventory: Inventory;
  lockedItemIds: Id[];
  // 图鉴的永久累计获得件数。值大于 0 即表示已经解锁；出售、消耗、丢弃与
  // 溃败都不会扣减。保留 discoveredItemIds 是为了兼容旧存档与旧调用方。
  itemAcquisitionCounts: Inventory;
  discoveredItemIds: Id[];
  pets: Record<Id, Pet>;
  unlockedMapIds: Id[];
  completedTaskIds: Id[];
  // 一次性玩家行为事实。只增不减、重复上报幂等，可作为任务目标。
  completedMilestoneIds: PlayerMilestoneId[];
  reachedEndpointIds: Id[];
  // `${mapId}:${nodeId}`；只在从该节点成功撤离后写入。
  completedExtractionNodeKeys: string[];
  discoveredNodeIds: Id[];
  // `${mapId}:${fromNodeId}:${edgeId}`；隐藏路线抵达目标节点后永久登记。
  discoveredRouteKeys: string[];
  expeditions: Expedition[];
  settlements: Settlement[];
  log: GameLogEntry[];
  nextId: number;
}

export interface RiskPreview {
  label: string;
  detail: string;
  // 仅完整情报返回，用于概率表格；UI 不解析 detail 文案。
  probabilities?: { extraSuccess: number; success: number; failure: number; bigFailure: number };
  // 第一档情报刻意不暴露实际概率，因此此时为 null。
  bigFailureProbability: number | null;
}

export interface Catalog {
  items: Record<Id, ItemDefinition>;
  tags: Record<Id, TagDefinition>;
  maps: Record<Id, MapDefinition>;
  events: Record<Id, EventDefinition>;
  eventPools: Record<Id, EventPoolDefinition>;
  tasks: Record<Id, TaskDefinition>;
  petTemplates: Record<Id, Pet>;
}
