# 节点基础战利品掉落系统

> 状态：玩法规则与 Demo 实现已确认  
> 最后更新：2026-09-10  
> 范围：宠物抵达普通探索节点时自动生成、由玩家手动拾取的基础战利品。地图起始节点与事件选项奖励不属于本系统。

节点的 `firstExtractionRewards` 是独立于随机掉落的固定清单：它只在第一次从该节点成功撤离时发放，不参与本文的独立抽取或组合表算法。清单可以包含多种物品，但每种物品的数量必须恰好为 1。

## 1. 目的与边界

配置了掉落的节点应产生一份可见的基础收获。队伍抵达节点时，系统先按照节点掉落配置生成待拾取战利品，再抽取节点事件并停下等待玩家；只有玩家实际拾取后才放入本轮背包。

例外：`startNodeId` 指向的起始节点只是无收益的路线入口，不配置掉落表、不抽取随机事件，也不计入完成节点数。入口可以拥有多条路线，玩家从中选择首个探索目标。

节点只有一个掉落配置，且必须在以下两种模式中二选一：

- `independent`：先抽数量，再让每件战利品独立抽取稀有度。
- `composition`：先从组合表抽取最终稀有度构成，再按构成抽取物品。

不支持一个节点叠加多个掉落组，也不支持“基础组 + 额外组”。事件奖励继续由事件系统独立提供。

## 2. 抵达节点的执行顺序

```text
队伍抵达节点
→ 读取该节点唯一的掉落配置
→ 生成并持久化本段基础战利品
→ 节点配置了事件池：抽取并持久化事件，停在 awaiting-event
→ 节点未配置事件池：直接进入 awaiting-route；终点进入 extraction
→ 存在 pendingLoot：先显示宝箱拾取界面，阻止执行后续事件/路线/撤离
→ 手动拾取：转入背包，解锁图鉴，并按实际拾取件数累加历史获得数量
→ 拾取完成或确认放弃剩余物品：清除 pendingLoot，开放对应阶段操作
```

存在随机事件时，掉落和事件共用本轮的确定性随机种子。生成结果写入存档，刷新页面或晚回来都不能重新抽取。

玩家回来后，在同一界面依次看到：

1. 本段自动发现的战利品。
2. 当前背包格子、负重和超载状态。
3. 当前节点事件及其风险。

玩家可以在选择事件方案前整理背包。只有拾取的战利品计入负重，因此“拿走重物承担更高事件风险”与“放弃收获换取稳妥”是节点决策的一部分。左键拾取一件、右键拾取一组，全部拾取只拿格子装得下的部分；离开时剩余物品必须确认放弃。

## 3. 公共物品池与过滤

当前基础候选池是物品目录中与目标稀有度相同的全部普通随机掉落物。每个节点可以配置：

```ts
interface NodeLootPoolFilter {
  whitelistItemIds?: string[];
  whitelistItemTags?: string[];
  blacklistItemIds?: string[];
  blacklistItemTags?: string[];
}
```

过滤顺序固定为：

```text
全部普通随机掉落物
∩ 当前抽中的稀有度
∩（白名单物品 ID ∪ 白名单物品 Tag 命中的物品）
－（黑名单物品 ID ∪ 黑名单物品 Tag 命中的物品）
= 最终候选物品
```

规则：

- 这里的“物品 Tag”是 `ItemDefinition.tags` 中的分类标签，不是宠物的永久 Tag。
- 物品 ID 白名单和物品 Tag 白名单都省略或为空时，不限制候选物品。
- 任一白名单非空时，显式物品 ID 或任一选中物品 Tag 命中即可进入候选池。
- 黑名单始终在白名单之后排除。
- 显式物品 ID 或任一选中黑名单物品 Tag 命中，都会排除该物品。因此可以先用 Tag 批量纳入，再用物品 ID 排除个例。
- 同一物品 ID 或同一物品 Tag 不能同时出现在各自的白名单和黑名单中。
- 名单中的物品 ID 必须存在且不得重复；物品 Tag 必须至少被一个物品使用且不得重复。
- Tag 成长道具不能进入普通随机掉落池，即使被写入白名单也不允许应用配置。
- 某个可能出现的稀有度经过过滤后没有候选物品时，配置无效；运行时不得静默降档、改抽其他稀有度或少发物品。

同一稀有度内的候选物品等概率抽取。每个物品槽独立抽取，允许重复，重复结果合并成物品数量。

## 4. 独立抽取模式

### 4.1 配置结构

```ts
interface IndependentNodeLootDefinition {
  mode: "independent";
  minCount: number;
  maxCount: number;
  countWeights?: Record<string, number>;
  rarityWeights: Partial<Record<Rarity, number>>;
  whitelistItemIds?: string[];
  whitelistItemTags?: string[];
  blacklistItemIds?: string[];
  blacklistItemTags?: string[];
}
```

示例：

```json
{
  "mode": "independent",
  "minCount": 3,
  "maxCount": 5,
  "rarityWeights": {
    "common": 50,
    "uncommon": 30,
    "rare": 15,
    "epic": 5
  },
  "blacklistItemIds": ["poop"]
}
```

### 4.2 数量抽取

- 未配置 `countWeights` 时，`minCount` 到 `maxCount` 之间的每个整数等概率。
- 配置 `countWeights` 后，只会抽到权重大于 0 的数量。
- 权重无需相加等于 100，实际概率为当前权重除以全部正权重之和。

示例：

```json
{
  "countWeights": {
    "3": 30,
    "4": 50,
    "5": 20
  }
}
```

对应 3、4、5 件的概率分别为 30%、50%、20%。

### 4.3 稀有度与物品抽取

确定数量后，每件物品独立执行：

```text
按 rarityWeights 抽取稀有度
→ 对公共物品池应用稀有度、白名单和黑名单过滤
→ 从最终候选物中等概率抽取一件
```

独立模式允许任何自然组合，包括极端但低概率的结果。固定抽 4 件且稀有度权重为白 50%、绿 30%、蓝 15%、紫 5% 时：

```text
P(恰好 1紫 + 1蓝 + 2白)
= 4! / (1! × 1! × 2!) × 0.05 × 0.15 × 0.50²
= 2.25%
```

## 5. 组合表模式

### 5.1 配置结构

```ts
interface LootCompositionDefinition {
  id: string;
  weight: number;
  rarityCounts: Partial<Record<Rarity, number>>;
}

interface CompositionNodeLootDefinition {
  mode: "composition";
  minCount: number;
  maxCount: number;
  compositions: LootCompositionDefinition[];
  whitelistItemIds?: string[];
  whitelistItemTags?: string[];
  blacklistItemIds?: string[];
  blacklistItemTags?: string[];
}
```

示例：

```json
{
  "mode": "composition",
  "minCount": 3,
  "maxCount": 5,
  "compositions": [
    {
      "id": "basic",
      "weight": 50,
      "rarityCounts": { "common": 3, "uncommon": 1 }
    },
    {
      "id": "rare",
      "weight": 20,
      "rarityCounts": { "rare": 2, "uncommon": 3 }
    },
    {
      "id": "epic",
      "weight": 5,
      "rarityCounts": { "epic": 1, "rare": 1, "common": 2 }
    }
  ]
}
```

### 5.2 抽取算法

```text
按 composition.weight 抽取一个组合
→ 按 Rarity 固定顺序遍历该组合
→ 每个稀有度抽取 rarityCounts 指定数量的物品
→ 合并重复物品
```

组合实际概率为：

```text
当前组合 weight ÷ 所有组合 weight 之和
```

组合中各稀有度数量之和必须位于 `minCount` 到 `maxCount` 之间。组合表只会产生明确列出的稀有度构成，不会额外生成其他组合。

## 6. 两种模式的使用边界

| | 独立抽取 | 组合表 |
|---|---|---|
| 控制对象 | 每件物品的稀有度概率 | 最终稀有度构成 |
| 极端结果 | 自然允许 | 只有显式配置才会出现 |
| 配置成本 | 低 | 较高 |
| 推荐用途 | 普通搜索节点 | 宝箱、特殊节点、终点 |

不得在独立模式抽完后强行修正结果以逼近某个构成。需要精确控制最终构成时，应直接选择组合表模式。

## 7. 配置校验

配置台应用目录前必须检查：

- 每个地图节点恰好配置一个 `loot` 对象。
- `mode` 只能是 `independent` 或 `composition`。
- `minCount`、`maxCount` 是不小于 1 的整数，且最小值不大于最大值。
- 数量、稀有度和组合权重必须合法，并且至少有一个正权重条目。
- `countWeights` 的键必须是数量范围内的整数。
- 组合 ID 非空且不重复，组合权重大于 0。
- 组合中的各档数量是非负整数，总数位于节点数量范围内。
- 所有名单物品存在、不重复，同一物品 ID 不在黑白名单中重叠。
- 所有物品 Tag 至少被一个物品使用、不重复，同一物品 Tag 不在黑白名单中重叠。
- 所有可能出现的稀有度在过滤后至少有一件候选物品。
- Tag 成长道具不进入普通随机池。

配置错误必须阻止“应用到 Demo”，不能依靠运行时兜底改变掉落结果。

## 8. 存档字段

`Expedition` 使用三个不同字段：

- `arrivalLoot`：最近一次抵达节点生成的完整基础战利品快照，用于宝箱展示。拾取或丢弃不会修改这份快照。
- `pendingLoot?`：尚未拾取的物品。字段存在（包括空对象）时必须完成拾取步骤；旧存档没有该字段，沿用旧的已入包结果，不补发。
- `cargo`：当前真实背包，会受手动拾取、事件奖励、丢弃和撤离出售影响。

选择下一路线后清空 `arrivalLoot`；抵达下一个节点时写入新的本段报告。

## 9. 与其他系统的关系

- 节点掉落先于事件生成，只有实际拾取入包后才影响当前事件的超载风险。
- 手动拾取和事件奖励进入背包时立即解锁图鉴并累计实际件数；未拾取的发现不计数。
- 普通事件失败可以按事件规则遗失背包物品，但不会撤销图鉴登记或扣减累计获得件数。
- 大失败导致全队失能并溃败时，本轮未安全带回的自动掉落与事件奖励一并遗失。
- 成功撤离后，保留的自动掉落与事件奖励没有资产层面的区别。
- 战利品经验仍以“成功带出来”为判据：入库和撤离时出售的计算，丢弃和溃败遗失的不计算。

## 10. 相关代码

- 类型：`src/domain/types.ts`
- 抽取算法与抵达结算：`src/domain/engine.ts`
- 示例节点配置：`src/domain/catalog.ts`
- 配置校验：`src/config/catalogStore.ts`
- 手动拾取界面：`src/ui/ExpeditionView.tsx`
- 手动拾取契约与原型映射：`docs/adventure-prototype-fidelity.md`
