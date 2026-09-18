# Demo 架构与扩展方式

> 最后更新 2026-08-18。改了引擎或目录结构请顺手更新本文——
> 它是新 agent 判断「代码现在长什么样」的唯一依据。

## 0. 从哪读起

| 你要做的事 | 先读 |
|---|---|
| 理解玩法规则、判断某个改动是否违背既有约定 | `docs/game-system-design.md`（第 12 节否决清单和第 14 节不变量是硬约束） |
| 改引擎、加内容、接 UI | 本文 |
| 做界面 | `DESIGN.md`（桌宠 UI 层级与交互基线） |
| 用美术资源 | `assets/ASSETS-HANDOFF.md` |

规则层的唯一真相是 `src/domain/engine.ts` 与其测试；设计文档描述意图，代码描述现状，两者冲突时先查是哪一边过时了再动手。

## 1. 目标

当前 Demo 是系统垂直切片，不是正式内容版本。它需要验证：

- 玩家等待后回来做事件决策是否成立。
- 事件结果是否会改变路线和撤离判断。
- 伤势、负重、背包格子与丢弃战利品是否形成取舍。
- 普通物品在出售、保留和任务提交之间是否产生经济决策。
- 账号任务与解锁内容能否驱动下一轮冒险。

## 2. 分层

### `src/domain/types.ts`

只包含可序列化的领域类型。领域状态不得持有函数、DOM 对象或 React 对象。普通探索节点的 `loot` 字段使用判别联合类型，保证只能配置 `independent` 或 `composition` 一种基础掉落算法；起始节点省略该字段。

### `src/domain/catalog.bundled.json` / `catalog.ts`

`catalog.bundled.json` 是配置台导出的完整内置内容目录，包括：

- 宠物模板。
- Tag。
- 物品。
- 固定地图和节点连线。
- 节点唯一的基础战利品掉落配置。
- 事件与事件池。
- 账号任务。

`catalog.ts` 只负责将这份 JSON 暴露为 `bundledCatalog`，并允许配置台用已发布目录替换运行时 `catalog`。后续策划内容以配置台导出 JSON 为准；旧的 `catalog.*Loot.ts` 是迁移前内容文件，不再被运行时加载。

各档位的数量、地图数量、事件数量都还在变动中，不在文档里固定。以代码和配置台显示的为准。

**`tools` 分类已删除。** 工具现在就是带 `tool` 标签的普通物品（见设计文档 9.1），目前有 15 件。

旧的 `ToolDefinition` / `OwnedTool` / `buyTool` / `upgradeTool` / `toolCharges` / `Expedition.toolIds` / `permanentLoad` 已于 2026-08-18 从引擎、类型、UI 和配置台全部移除。连带删除的还有 `EventChoiceDefinition.requiredToolId` 和 `RouteRequirement.toolId`，因此**目前没有任何「要求携带某件物品」的门禁**——门禁只有主属性硬门槛、次要属性和 Tag 三种。若设计文档 9.2 决定保留「工具解锁选项」，需要以 `requiredItemId` 的形式重新实现。

正式内容 agent 可以在不修改引擎的情况下替换或增加目录数据。引擎不写死任何具体内容 ID：初始宠物取目录里的第一个模板，起始地图取编号最小的一张。

### `src/domain/engine.ts`

纯 TypeScript 规则层。所有导出操作都遵循：

```ts
nextState = action(previousState, input)
```

函数不会原地修改调用方传入的状态。主要操作包括：

- `createInitialState`（开新档）
- `startExpedition`
- `tick`
- `drawNodeLoot`
- `resolveEvent`
- `chooseRoute`
- `requestExtraction`
- `discardCargo`
- `sellCargoItem`
- `confirmExtraction`
- `dismissSettlement`
- `sellWarehouseItem`
- `toggleItemLock`
- `healPet`
- `completeTask`
- `expandWarehouse`
- `allocateStat`
- `resetPetStats`
- `applyTagItem`
- `applySecondaryGrantItem`

除了这些改状态的动作，引擎还导出一批**只读查询**给 UI 用，例如
`cargoSlotCapacity` / `isCargoOverSlots` / `lockedNodeEvents` /
`checkSecondaryRequirement` / `teamSecondaryStat` / `lootXp` /
`xpToNextLevel` / `maxLevel` / `secondaryStatCap`。
规则永远写在这里，UI 不得自己重算——界面上出现的每个数字都应该有一个对应的导出函数。

`startExpedition` 的输入契约为 `StartExpeditionInput`：

```ts
{ mapId: Id; petIds: Id[]; cargo?: Inventory; foodItemId?: Id }
```

`cargo` 是玩家从仓库选择的初始携带物。引擎会校验物品存在、数量为正整数、仓库库存充足和背包格子不超限，然后在同一次状态变更中从 `GameState.inventory` 扣除并写入 `Expedition.cargo`。`Expedition.initialCargo` 只用于区分旧物品与本轮新战利品，避免重复获得战利品经验，不提供资产保护：携带物可以被事件损失、主动丢弃或撤离时出售，溃败时与其他 cargo 一起丢失。省略 `cargo` 与传入空对象等价，因此旧调用方无需修改。

#### 食物效果

设计共识见 [系统设计 §9.3](game-system-design.md)。代码这边只有四个读取点和三个入口：

| 读取点 | 改了什么 | 自动覆盖 |
| --- | --- | --- |
| `teamStat` | 队伍结算结果 + buff | 事件检定风险、路线主属性门槛 |
| `teamStatForPets` | 从 `state.expeditions` 反查真远征再调 `teamStat` | 地图情报等级、UI 的 `routeHint` |
| `teamCarryCapacity` | 体能 buff × `CARRY_PER_FITNESS`，只加一次 | 负重上限、超载惩罚 |
| `cargoSlotCapacity` | 技巧 buff × `SLOTS_PER_TECHNIQUE`，只加一次 | 格子上限 |

**`teamStatForPets` 那处反查不是可选的**：路线按钮的**可用性**走 `getRouteAvailability → teamStat`（拿得到 expedition，带 buff），**提示文字**走 `routeHint → teamStatForPets`。不反查就会出现按钮能点、旁边却写着「体能不足」。

三个入口和它们在界面上的位置：

| 引擎入口 | 界面 | 说明 |
| --- | --- | --- |
| `startExpedition(input.foodItemId)` | 行前整备的探险背包栏下方 | 「出发前吃」下拉；只列有 `foodBuff` 的食物，并写出放弃的售价 |
| `eatCargoFood` | 探险中「整理背包」弹窗 | 选中食物时出现「吃掉」按钮，和「丢弃」并排 |
| `healPetWithFood` | 库存面板的「使用」流程 | 复用赋予特质 / 次要属性成长那套选宠物确认框 |

行前整备是**选定**不是吃掉：草稿存在 `View.foodItemId`，食物被卖掉或配置改了会和 `cargo` 一样自动从草稿里撤掉。
`eatCargoFood` 的按钮文案会写明**会顶掉哪个现有 buff**——同时只存在一个 buff，没有这句话玩家会误吃掉更好的那个，`foodModel.test.ts` 专门盯着它。
治疗目标不让玩家选，固定治伤得最重的那只（并列取 `petIds` 靠前的），UI 与引擎用同一条规则。

`Expedition.foodBuff` 存的是**吃下那一刻的快照**而不是 `itemId` 引用。配置台的已发布目录会整个替换 `catalog`，远征又跨重启存活；回目录重算的话，策划改数值或删物品会让在途冒险的容量当场缩水，玩家超格被卡在节点上、被迫丢弃已经捡到的战利品。`arrivalLoot` 出于同样的理由也是快照。

引擎唯一被推翻的旧规则：`healPet` 的「宠物正在冒险途中，无法接受治疗」**只对食物开口**，花钱治疗仍然只能在基地。

### `src/config/`

策划配置台，与游戏共用同一个 `src/domain`，通过 `?config=1` 进入。

- `catalogStore.ts`：草稿 / 已发布目录的读写，以及 `validateCatalog` 全量校验。**新增任何目录字段都要在这里补校验**，否则手写 JSON 的错误会一路漏进运行时。
- `ItemForm.tsx` / `PetForm.tsx` / `TaskForm.tsx`：物品、宠物与任务的结构化表单。任务表单覆盖提交物品、提交货币、首次通关地图、玩家里程碑、前置任务和全部现有账号奖励。
- `MapForm.tsx`：地图基础信息（名称、编号、起始节点、情报阈值）直接在页面上编辑，跟其他表单一样由底部「保存这条记录」落盘。
  节点和路线都走**拓扑图入口**：从当前草稿自动生成入口向右分层的有向拓扑预览，不可达节点和悬空路径会在图中提示。
  **点节点**弹出节点浮层（名称、角色、掉落表、白/黑名单、事件池、首次撤离奖励）；**点连线**弹出这条路线自己的浮层
  （路线 ID、显示名称、目标节点、行进时间、说明、次要属性门槛、隐藏路线 Tag）。两个浮层同一时刻只开一个。
  浮层改的是副本，点「保存」一次就写进 catalog 草稿并关闭，「取消」/ Esc / 点背景丢弃改动（有改动时会先确认）。
  新增节点、新增路线（在图下方选起点和终点）都会自动打开对应浮层；删除节点、删除路线也在各自浮层里完成。
  节点浮层里的路线是**只读一览**：同一条边只有「点连线」这一个编辑入口，否则两处保存会互相覆盖。
  1.5px 的连线用一条透明粗线撑出点击热区（偏离中心 12px 仍点得中），否则鼠标压根压不中。
  节点或路线保存都会把整条地图记录（含尚未保存的基础信息改动）一起落盘——这是同一条记录，无法只存其中一块。
- `mapNodeDraft.ts`：上面这套「草稿 → 保存」的纯逻辑（脏检查、写回节点、删除节点连带清路线、入口层级 BFS、节点角色判定，
  以及按「起点 id + edges 下标」定位的路线增删改和路线角色判定），不依赖 React，由 `mapNodeDraft.test.ts` 覆盖。
  路线没有全局唯一 key（`route id` 只在所属节点内唯一），所以一律用下标定位，和拓扑图连线的 `data-edge-id` 保持一致。
- `EventForm.tsx`：事件基础信息、事件抽取门槛、选项顺序、三类结算方式、Tag 门槛、基础奖励和大成功额外奖励的结构化编辑器。主属性检定配置属性与难度；次要属性判定配置成功/大成功双门槛；直接离开会自动清空奖励和门槛。
- `EventPoolForm.tsx`：按名称、ID 或描述搜索事件并勾选事件池成员；当前池内可用事件按统一等权规则抽取。
- 地图编辑的真交互回归跑 `npm run test:config-map`：它起一个 Vite dev server 和 Electron 壳指向 `?config=1`，用 CDP 派发真实鼠标事件做命中测试，
  覆盖点节点 / 点连线开浮层、保存落盘、刷新保留、取消丢弃、新增与删除节点 / 路线、键盘 Enter 与 Esc 通路，
  以及两处容易回归的盒模型：长表单时浮层必须夹在视口内（保存栏不能被顶出屏幕）、「新增路线」按钮不能被 flex 压成竖条。
  连线的命中点是沿路径取中点再用 `getScreenCTM()` 换算屏幕坐标（按包围盒中心会落在曲线外），另外单独量一次偏离多少像素仍能点中。
- 配置台仍保留 Raw JSON 模式处理低频字段；发布前的完整校验会检查事件文本、选项 ID、检定字段、奖励引用、门槛引用和事件池重复成员。
- 配置台可以导入 / 导出整份目录 JSON，策划改完再「应用到 Demo」。

### `src/gm/`

GM 后台，只在开发模式存在：`npm run dev:desktop`（或 `npm run dev`）启动后，窗口左下角有一块浮层，
收起后是一个 `GM` 圆钮。配置台界面（`?config=1`）不挂它。

- `gmActions.ts`：全部 GM 操作的纯函数——立即抵达、快进 N 毫秒、基地伤势痊愈、加减金币，
  外加两个查询（在基地养伤的宠物数、最近一次抵达倒计时）。
  每个操作都是「旧存档 → 新存档」，改完一律再过一遍 `tick`：抵达掉落、伤势档位这些结算仍走引擎原来的流程，
  GM 只负责把时间拨过去，不自己实现一套。战报和日志的 `createdAt` 是历史记录，快进不会动它们。
  出门在外的宠物没有 `injuryRecoveredAt`（出发会清掉，途中本来就不自愈），所以「伤势痊愈」只作用于基地里的宠物。
  由 `gmActions.test.ts` 覆盖。
- `GmPanel.tsx` / `mountGmPanel.tsx`：面板挂在 `#root` 之外的独立 React 根上，不参与游戏的 state，
  只通过 `window.__idleGm`（`App.tsx` 里一个 dev-gated 的 `useEffect` 挂上去的把手）读写存档。
  根节点带 `data-desktop-ui`：桌宠窗口默认整块鼠标穿透，带这个属性的元素才点得到。
  面板固定在窗口左下角，那一片是 `computeNativeLayout` 一直为面板预留的透明区域，不会挡住宠物。

**打包绝对不会带上它**，由两道闸守着：

1. `src/config/productionBundle.test.ts` 真的跑一次生产构建，断言模块图里没有 `/src/gm/`，
   并在产物文本里搜 `__idleGm` / `idle-gm-root` / `gm-panel` / `GM 后台`。
   这条断言被反向验证过：往 `App.tsx` 里加一句静态 `import { GmPanel }`，测试会挂。
2. `tools/verify-package.mjs` 在流水线末端扫真实的 `app.asar`，同样的标记出现在任何 html/css/js/json 里就报错。

原理是 `main.tsx` 里那句 `if (import.meta.env.DEV && !editing)`：生产构建把 `import.meta.env.DEV` 替换成字面 `false`，
整个 `if` 连同里面的动态 `import("./gm/mountGmPanel")` 被 Rollup 摇掉。
生产产物只多出 `App.tsx` 里那个被掏空的 `useEffect` 外壳（约 30 字节）。
- 开发服务器启动时，配置台还提供「覆盖游戏数据」：先由服务端对当前草稿做完整校验，并与磁盘上的 `catalog.bundled.json` 逐分类比较新增、删除和修改的记录 ID；玩家确认摘要后，服务端再次校验并检查内置目录与草稿指纹都未变化，再用临时文件原子覆盖内置 JSON。存在错误时禁止覆盖，警告允许在明确确认后继续。
- 覆盖成功会清除浏览器里的草稿/已应用覆盖层并重置 Demo 存档，使下一次加载直接使用刚写入的代码内置目录。该能力只挂载在 `npm run dev` 的本地 Vite 服务中，生产构建不会暴露写文件接口。

注意目录数据有代码内置和 localStorage 两层，localStorage 会盖住代码内置的那份；同步靠配置台的「恢复默认」。

### `src/persistence/storage.ts`

将完整 `GameState` 存入 `localStorage`。事件抽取结果和冒险阶段会一起保存，因此刷新不能重抽事件。

### `src/ui/App.tsx`

占位 React UI，只读取状态、展示选择并调用领域动作。不得在组件内重算或复制游戏规则。

## 3. 冒险状态

每支队伍独立处于以下阶段之一：

```text
traveling
→ awaiting-event
→ awaiting-route
→ traveling

traveling
→ awaiting-route（无事件的普通节点）

awaiting-route
→ extraction

terminal event / 无事件终点
→ extraction
```

`extraction` 是最后一个阶段：`confirmExtraction` 在同一步里完成入库、发经验、开始伤势恢复计时，并留下一条只读战报（`GameState.settlements`）。战报不是一个待办阶段，也不占用宠物。

`awaiting-route` 和 `extraction` 阶段都可以整理背包。背包格子超限时，`chooseRoute` 和 `confirmExtraction` 都会拒绝，队伍停在原地直到玩家丢弃到上限以内。

多支队伍可以并行计时。同一只宠物同一时间只能被一支队伍占用。

2026-09-10：节点掉落改为手动拾取。`pendingLoot` 是上述阶段之前的拾取门禁，不额外增加 phase 枚举。只要字段存在，必须先执行拾取/确认放弃并 `finishNodeLoot`，才能处理事件、选择路线或撤离；详情见 `docs/adventure-prototype-fidelity.md`。

## 4. 时间

Demo 地图使用 8–16 秒等待，方便测试。正式时间完全由地图和路线目录数据控制：

```ts
MapDefinition.startDurationMs
MapEdgeDefinition.durationMs
```

队伍抵达起始节点后由 `tick` 推进到 `awaiting-route`，不生成掉落或事件；入口可配置多条出边。抵达普通探索节点后，配置了事件池则推进到 `awaiting-event`，未配置事件池则直接推进到 `awaiting-route`，无事件终点推进到 `extraction`。再次调用 `tick` 不会继续推进或产生迟到惩罚。

## 5. 随机与存档

- 每支冒险队保存独立随机种子。
- 起始节点不消费随机种子、不生成基础战利品或事件，抵达后直接等待路线选择。
- 抵达普通探索节点时先用节点掉落表生成基础战利品；配置了事件池时再抽取事件，两者按顺序消费同一随机种子。
- 节点基础掉落支持独立抽取与组合表二选一，完整算法见 `docs/loot-drop-system.md`。
- 节点掉落写入 `Expedition.arrivalLoot` 作为完整快照、`pendingLoot` 作为待拾取清单；实际拾取才合并进 `cargo`。刷新不能重新随机。旧存档没有 `pendingLoot` 时不重复发放。
- 节点事件池可以省略或留空，表示该节点没有随机事件；非空时从关联事件池的并集中抽取。
- **先按次要属性门禁过滤**：够不到的事件不参与抽取。副作用是属性低时可用事件更少、重复率更高，配事件池时要保证低门槛事件够用。
- 再优先排除本轮已经抽到的事件。
- 事件 ID 立即写入 `Expedition.currentEventId`。
- 页面刷新后继续使用已保存事件，不能重新随机。

被门禁挡掉的事件由 `lockedNodeEvents` 报给 UI。它由「访问过的节点 + 目录」推导，不需要额外存档字段，因此节点一旦进过 `discoveredNodeIds`，玩家在后续的路线选择界面就能一直看到那里的门槛（永久地图知识）。

地图选择界面的情报档位由 `mapInformationTier` 即时计算：选中队伍的有效感知与 `MapDefinition.informationThresholds.partial/full` 比较，不写入存档。普通地图拓扑始终可见；隐藏连线只有实际抵达其目标节点后才写入 `GameState.discoveredRouteKeys`。感知不会产生或绕过这条发现记录。

当前随机函数是可复现的轻量 xorshift，只用于玩法 Demo，不用于安全或联网对战。

## 6. 内容扩展

### 新物品

向对应稀有度的 `catalog.*Loot.ts` 增加 `ItemDefinition`：

```ts
{
  id: "item-id",
  name: "显示名",
  rarity: "common",
  weight: 2,
  sellValue: 10
}
```

约束：

- `rarity` 必填，取 `common | uncommon | rare | epic | legendary | mythic`，配置校验会拦截非法值。
- `weight` 下限 0，最小粒度 0.1（1 点负重 ≈ 0.2 kg）。重量只影响冒险途中的背包负重，不影响仓库。
- `stackSize` 可选，表示每格能堆多少个。省略即为 1（一件一格）。写了就必须是 ≥1 的整数，配置校验会拦截。堆叠上限由内容显式配置，不从重量或稀有度推导。
- `description` 只在传说和神话档位填写，其余档位不写。
- `sellable` 必填。可出售时必须同时给出大于 0 的 `sellValue`；不可出售时不能保留 `sellValue`。两种写错法配置校验都会拦（不变量 14）。
- 若物品赋予永久 Tag，设置 `tagGrantId`，并把 `sellable` 设为 `false`。
- 若物品提升次要属性，设置 `secondaryGrant: { stat, amount }`。这类道具**可以出售**，与 Tag 道具不同；`tagGrantId` 与 `secondaryGrant` 互斥，配置校验会拦。加成数值写在物品上，不从稀有度推导。

### 新事件

1. 向 `catalog.events` 增加事件。
2. 为事件提供一个或多个选项。
3. 将事件 ID 加入相应 `eventPools`。
4. 把事件池 ID 绑定到固定地图节点。

事件选项通过 `resolution.type` 在三类结算方式中选择：

- `primary`：配置主属性和难度，掷骰后走四档结果。
- `secondary`：配置次要属性、成功门槛和大成功门槛；不达标置灰，达标后确定性结算，不消耗随机数。
- `leave`：始终可选，不检定、不发奖励、不受损失，以“已离开”结束事件。

主属性检定使用四档结果：`margin >= 6` 为大成功（基础奖励 + 额外奖励），`3～5` 为成功（基础奖励），`0～2` 为失败（无事发生），`< 0` 为大失败（随机可行动宠物伤势 +1）。`margin = roll - 风险值`；幸运儿的 roll 为两次 D6 取高。大失败后只有全队失能才溃败。次要属性判定只有成功和大成功；成功门槛以下不能点击，大成功门槛必须严格更高。
因此低等级队伍只在低难度选项上摸得到额外奖励；任务需要的物品不要只挂在额外奖励里。

**三种门禁**，作用范围和玩家体验各不相同：

| 写在哪 | 字段 | 不满足时 |
|---|---|---|
| 次要属性事件选项 | `resolution: { type: "secondary", stat, successThreshold, extraSuccessThreshold }` | 低于成功门槛时选项**置灰**；第一档仅提示不足，第二档仅在不足时显示成功门槛，第三档始终显示成功与大成功门槛 |
| 整个事件 | `EventDefinition.requiredSecondary` | 该事件**不参与本节点抽取**，改为在节点信息里列出所需属性与数值 |
| 事件选项 | `requiredTagId` | 选项不可用 |

一个门禁只能对应一项次要属性——`SecondaryRequirement` 是单对象而不是映射，这条规则在类型层面就无法违反。跨类组合（次要属性 + Tag）允许。

次要属性门禁对应的内容必须始终可见（设计文档不变量 17），但具体条件严格按事件三档情报展示，且不显示当前值。需要「玩家事先完全不知道」的隐藏内容，用 Tag 触发，别用次要属性。

### 新地图

- 地图必须是无循环有向图。
- 节点和连线固定。
- 每个非起始节点必须配置且只能配置一个 `loot`，在独立抽取和组合表中二选一；起始节点不配置掉落与事件池。配置示例见 `docs/loot-drop-system.md`。
- 节点可以通过一个或多个事件池提供有限随机内容，也可以不配置事件池。
- 只有中途撤离点和固定终点可配置 `firstExtractionRewards`。第一次从该节点成功撤离时发放一次；可以列出多种物品，但每种数量必须为 1。
- 中途撤离点使用 `extractable: true`；普通探索节点省略该字段且不能主动撤离。
- 终点使用 `terminal: true`，天然是撤离点并在事件处理后强制进入撤离。
- 隐藏路线使用 `requirement.tagId` 与 `hidden: true`；普通路线禁止使用 Tag 门槛。
- 路线门禁写在 `MapEdgeDefinition.requirement`，支持 `tagId` / `minimumStat`（主属性硬门槛）/ `secondary`（次要属性硬门槛）。
- 次要属性与主属性门槛不会隐藏路线：路线保持可见，不满足时置灰并显示所需值与当前值。
- `hidden: true` 必须和有效的 `requirement.tagId` 一起配置。未发现时只有携带 Tag 的队伍在源节点能看见；抵达目标节点后写入连线级永久发现记录。已发现路线对所有队伍显示，但没有 Tag 仍不可通行。配置台拓扑图始终显示它，并用虚线标识，方便策划编辑。
- `informationThresholds.partial/full` 配置本图第二档与第三档情报的感知阈值，必须是整数且 `full > partial`。
- `nodeXp` 配置本图每完成一个非起始节点获得的基础经验，必须是不小于 0 的整数；旧配置省略时按 10。
- 单轮深度应遵守系统设计文档中的进程约束。

### 新任务

任务可以要求：

- 提交任意常规物品。
- 提交通用货币。
- 首次通关指定地图，即从该地图任意固定终点成功撤离；中途撤离点撤离不算。
- 完成玩家里程碑。当前内置里程碑为打开探险与任务、库存、宠物状态、图鉴、设置五个面板。
- 物品、货币和目标可以任意组合，配置的条件全部采用 AND。

里程碑由 UI 在真实交互发生时调用 `recordMilestone` 上报，引擎幂等写入 `GameState.completedMilestoneIds`；重复打开不重复记录，刷新后保留。任务只读取这份永久事实，不读取 React 当前面板状态，也不会因完成里程碑自动领取奖励。

任务只有在全部 `prerequisiteTaskIds` 已完成后才出现。前置任务不存在、自引用、重复引用或形成循环时，配置校验会报错并阻止发布。

任务奖励可以：

- 增加通用货币。
- 解锁地图。
- 添加宠物。
- 发放物品。
- 增加仓库格子（`TaskReward.warehouseSlots`）。

任务不得奖励经验值或宠物属性点。奖励物品导致最终仓库超格时任务不能提交；若同一任务奖励仓库格子，则扩容在容量判断中同时生效。

## 7. 可调数值

全部集中在 `src/domain/engine.ts` 顶部的常量区。改数值只动这里，不要散到各处。

**负重与格子**

| 常量 | 含义 |
|---|---|
| `CARRY_BASE` / `CARRY_PER_FITNESS` | 单宠负重上限 = 基础 + 体能 × 系数 |
| `SLOTS_BASE` / `SLOTS_PER_TECHNIQUE` | 单宠格子上限 = 基础 + 技巧 × 系数 |
| `RESCUE_BURDEN` | 搬运一名失能队友占掉的负重 |
| `INITIAL_WAREHOUSE_SLOTS` / `WAREHOUSE_EXPANSION_SLOTS` | 仓库初始格数与每次扩容增量 |
| `DEFAULT_STACK_SIZE` | 物品未配置 `stackSize` 时的默认堆叠数 |

> 前四个数不能各自单独调。**分水岭 = 负重上限 ÷ 格子上限**，物品的「每格满载重量」（重量 × 堆叠数）高于它就先撞负重，低于就先撞格子。分水岭必须落在当前物品表的分布区间内，否则其中一条限制会彻底失效。改这几个数之前先跑一遍物品表的分布。

**队伍属性结算**

- 单支队伍最多编入 3 只宠物。
- 地图情报、事件主属性检定、大失败概率预览和路线主属性门槛共用 `teamStat`：先按伤势计算每只宠物的有效主属性，再取最高值；其他每只可行动且该属性有效值至少为 1 的成员各协助 `+1`。单队最多 3 只，因此协助天然最多 `+2`。
- 正常宠物主属性倍率为 `1`，受伤为 `0.75` 并向下取整，失能不参与。事件风险在此之外还会为每只受伤宠物增加 `0.5`、每只失能宠物增加 `2`。
- 次要属性在可行动成员中取最高值，不叠加、不提供协助。受伤不降低次要属性，失能成员不参与。
- 负重与格子是容量值，按成员相加：`单宠负重 = (5 + 体能 × 1.2) × 伤势倍率`，每名失能成员另扣 4 点救援负担；`单宠格子 = 8 + 技巧`，格子不受伤势影响。
- 感知使用当前地图的 `informationThresholds.partial/full` 同时决定地图预览和事件风险情报：第一档隐藏主属性选项危险信息，第二档显示按大失败概率划分的准确风险档位，第三档显示四种结果的准确概率。感知不修改节点掉落概率；若选项本身检定感知，它还会作为对应主属性进入风险公式。

**等级与经验**

| 常量 | 含义 |
|---|---|
| `MAX_LEVEL` / `POINTS_PER_LEVEL` | 等级上限与每级属性点 |
| `XP_CURVE_EXPONENT` / `XP_CURVE_K` | 升级需求 = 等级^指数 × k |
| `DEFAULT_NODE_XP` | 旧地图未配置 `nodeXp` 时的兼容默认值 |
| `LOOT_XP_BY_RARITY` | 各稀有度每件战利品的经验 |
| `DEFEAT_XP_RATIO` / `MIN_DEFEAT_XP` | 溃败时的经验折扣与保底 |

**次要属性与伤势**

| 常量 | 含义 |
|---|---|
| `SECONDARY_STAT_CAP` | 次要属性上限，所有宠物每项共用 |
| `INJURY_RECOVERY_MS` | 各伤势档位恢复到下一档所需的真实时间 |
| `INJURY_HEAL_COST` | 各伤势档位花钱立即治愈的价格 |

**目录侧的扩展口子**（不在常量区，写在内容数据里）

| 字段 | 作用 |
|---|---|
| `TaskReward.warehouseSlots` | 任务奖励仓库格子 |
| `MapDefinition.nodeXp` | 本图每个已完成节点的基础经验，省略按 10 |
| `ItemDefinition.secondaryGrant` | 次要属性成长道具的加成 |
| `TagDefinition.eventRollAdvantage` | 事件检定掷两次 D6 取高；队伍中多个不叠加 |

Tag 不提供任何主属性加成，`TagDefinition` 上也没有对应字段，见设计文档 7.1。

## 8. 已知缺口：设计文档写了但代码没实现

这一节是给接手 agent 的诚实清单。**设计文档描述的是意图，下面这些目前只存在于文档里**，动到相关区域时要么补上，要么先和策划确认是否还要。

| 文档出处 | 承诺 | 代码现状 |
|---|---|---|
| 7.1 Tag 的作用 | Tag 触发隐藏事件、路线、事件选项 | 隐藏路线的运行时判定、策划表单与校验已经实现；当前内置内容尚未实际配置隐藏路线。事件与选项仍沿用各自的 Tag 门禁字段 |
| 9.2 | 工具物品还保留哪些能力（解锁选项、每轮次数、升级） | 未决定。旧的 `ToolDefinition` 机制已于 2026-08-18 全部删除，包括 `requiredToolId` / `RouteRequirement.toolId`——**当前没有任何「要求携带某件物品」的门禁**，若 9.2 决定保留该能力，需要新增 `requiredItemId` 之类的字段重新实现 |

以下文档措辞是「可以」而非「必须」，属于未行使的选项，不是欠账：

- 6.4「高属性**可以**采用递增投入成本」——`allocateStat` 目前是 1 点换 1 属性的平价兑换。体能与技巧因为分水岭存在自我惩罚（堆单项会让另一条限制失效），感知因为按相对难度吃满也有天然递减，所以三项都已有内在递减，是否还需要额外成本待定。
- 10.4「图鉴**可以**记录物品的已知来源」——当前已经实现物品解锁、累计获得件数与未解锁剪影，但尚未记录具体来源与用途。

## 9. Demo 简化项

以下不是最终规则，只是当前垂直切片的简化：

- 属性重置免费。
- 仓库扩容价格线性提高。
- 只有一张地图、三个事件，深度不足以检验多分叉和多终点。
- Tag 目前只有「幸运儿」一个，且没有任何内容用 Tag 做门禁——设计文档给 Tag 的职责（触发隐藏事件、路线、选项）在内容侧尚未兑现。
- 次要属性成长道具只标在三件既有物品上（望远镜 / 威士忌 / 白鼬卡），口才还没有对应道具。
- UI 使用文本和基础 CSS，不引用正式美术资源。

## 10. 测试重点

`src/domain/engine.test.ts` 覆盖系统不变量：

- 晚回来不会继续结算或惩罚宠物。
- 事件结算先于路线承诺。
- 超载只增加事件风险，超重或背包超格均不阻止确认撤离；仅校验最终入库合并后的仓库格数，确认后战利品直接入库。
- 大失败不倒扣仓库、货币和既有成长；只有全队失能才溃败并丢失本轮携带物。
- 账号任务正确组合物品、货币、首次通关与玩家里程碑目标；里程碑重复上报幂等，提交时扣除资源并发放奖励，中途撤离不算地图通关。
- Tag 道具永久绑定且不能重复赋予。
- 仓库格子不足时拒绝撤离，战利品留在背包里不被销毁。
- 节点首次撤离奖励按 `mapId:nodeId` 分别记录，只在成功撤离时领取一次；仓库不足时不领取也不消耗资格，奖励重量不占冒险负重。
- 0.1 刻度的重量累加不产生浮点残渣，"刚好装满"不会被误判成超载。
- 堆叠按物品各自的 `stackSize` 计算，入库按合并后算格子。
- 背包超格阻塞下一步行动，丢弃后立即解除，且不扣收益。
- 撤离整理可以就地出售，冒险途中不能。
- 伤势恢复只在基地流逝，离线可连续恢复多档，带伤仍可出勤，花钱可立即治愈。
- 次要属性取可行动成员最高值、不叠加；受伤不降低次要属性，失能成员不参与。门禁对应内容保持可见，事件选项的具体条件按三档情报展示；成长道具按显式字段加点并封顶，不消耗属性点。
- 背包格子由技巧决定，加技巧当场生效；格子不受伤势影响而负重受影响。
- 升级曲线严格递增，满级后不涨级也不囤积经验；每张地图独立配置单节点基础经验；战利品经验按稀有度与件数累加；就地卖掉的算经验、丢弃的不算；溃败只给节点经验的一半且没有战利品经验。

`src/config/catalogStore.test.ts` 覆盖配置校验：

- 引用完整性与地图无环。
- 物品稀有度、堆叠数、成长道具字段合法性，两类成长道具互斥。
- 宠物模板必须配齐四项次要属性且不超上限。
- 三处次要属性门禁的字段格式，门槛高于上限时给警告。
- 任务货币、目标地图、奖励字段与前置任务引用合法，且前置关系无循环；经验奖励会被拒绝。

`src/domain/itemTags.test.ts` 覆盖物品分类标签；`src/config/lootIcons.test.ts` 保证每件物品都有同名图标、且没有多余图标。

`src/domain/rarity.test.ts` 覆盖稀有度约定：

- 六档顺序、合法值校验。
- 每件物品都有合法档位，重量落在 0.1 刻度上。
- 只有传说及以上写描述。
- 稀有度与"是否可出售、是否消耗品"相互独立。
- 物品 ID 与显示名不重复。

新增规则时，应优先为领域层补测试，而不是依赖 UI 点击验证。
