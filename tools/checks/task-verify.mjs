// 任务面板：任务自动接取、按任务线推进，规则与 catalog 逐字对齐
import { loadProto, catalog, strip, reporter } from './_stub.mjs';
import fs from 'node:fs';
const X = loadProto('prototypes/expedition-panel.html',
  'S:()=>S,TASKS,taskAvailable,taskCanComplete,visibleTasks,claimable,taskReqs,reqOk,'
  + 'rewardFits,act,render,invQty,usedSlots,whCap:(typeof whCap==="function"?whCap:()=>WAREHOUSE_SLOTS),'
  + 'stack,IT,el:id=>document.getElementById(id)');
const { die, ok, end } = reporter();
const cat = catalog();
const S0 = () => X.S();

// 1) 任务表逐字对齐 catalog——标题、描述、需求、奖励、前置都不许原型自己编
const ids = Object.keys(cat.tasks);
if (Object.keys(X.TASKS).length !== ids.length)
  die(`任务数 ${Object.keys(X.TASKS).length} ≠ catalog 的 ${ids.length}`);
for (const id of ids) {
  const a = X.TASKS[id], b = cat.tasks[id];
  if (!a) { die(`缺任务 ${id}`); continue; }
  for (const k of ['title', 'description'])
    if (a[k] !== b[k]) die(`${id}.${k} "${a[k]}" ≠ catalog "${b[k]}"`);
  for (const k of ['requirement', 'reward', 'prerequisiteTaskIds'])
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
      die(`${id}.${k} 与 catalog 不符`);
}
ok(`${ids.length} 条任务的标题 / 描述 / 需求 / 奖励 / 前置与 catalog 逐字一致`);

// 2) 没有「接取」这个动作——可见即已接取
const src = strip(fs.readFileSync('prototypes/expedition-panel.html', 'utf8'));
if (/data-a="task-(take|accept)"/.test(src)) die('原型里出现了手动接取按钮');
ok('任务自动接取：面板里没有任何「接取」动作');

// 3) 任务线推进：完成一条线的当前任务，下一个自动出现；多条线并行
const line = ['tasks-game-start', 'tasks-expand-storehouse-1', 'tasks-expand-storehouse-2'];
const S = S0();
S.doneTasks = [];
if (X.taskAvailable(line[1])) die('前置未完成时后续任务不该可见');
for (let i = 0; i < line.length - 1; i++) {
  S.doneTasks = line.slice(0, i + 1);
  if (!X.taskAvailable(line[i + 1])) die(`完成 ${line[i]} 后 ${line[i + 1]} 应自动出现`);
  if (X.taskAvailable(line[i])) die(`${line[i]} 已完成，不该还在列表里`);
  if (line[i + 2] && X.taskAvailable(line[i + 2]))
    die(`${line[i + 2]} 隔着一级前置，不该出现`);
}
S.doneTasks = [];
const vis = X.visibleTasks();
const noPrereq = ids.filter(id => !(cat.tasks[id].prerequisiteTaskIds || []).length);
if (JSON.stringify(vis.sort()) !== JSON.stringify(noPrereq.sort()))
  die(`初始可见任务 ${vis} ≠ 无前置的 ${noPrereq}`);
if (noPrereq.length < 2) die('至少应有两条任务线并行');
ok(`任务按线推进（${line.length} 级链逐级解锁），${noPrereq.length} 条线并行可见`);

// 4) 三类需求各自的达成判定
S.warehouse = [['nail', 11]]; S.currency = 0; S.clearedMaps = []; S.milestones = [];
const reqOf = id => X.taskReqs(X.TASKS[id]);
const byKind = (id, k) => reqOf(id).filter(q => q.kind === k);
const nailReq = byKind('tasks-expand-storehouse-1', 'item').find(q => q.id === 'nail');
if (X.reqOk(nailReq)) die('11 < 12 时物品需求不该算达成');
S.warehouse = [['nail', 12]];
if (!X.reqOk(reqOf('tasks-expand-storehouse-1').find(q => q.id === 'nail'))) die('12 ≥ 12 应算达成');
S.currency = 799;
if (X.reqOk(byKind('tasks-expand-storehouse-1', 'currency')[0])) die('货币不足不该算达成');
S.currency = 800;
if (!X.reqOk(byKind('tasks-expand-storehouse-1', 'currency')[0])) die('货币刚好应算达成');
if (X.reqOk(byKind('tasks-pass-map-1', 'map')[0])) die('未通关不该算达成');
S.clearedMaps = ['map-1'];
if (!X.reqOk(byKind('tasks-pass-map-1', 'map')[0])) die('通关 map-1 后应算达成');
if (X.reqOk(byKind('tasks-game-start', 'ms')[0])) die('里程碑未达成不该算达成');
S.milestones = cat.tasks['tasks-game-start'].requirement.goals.map(g => g.milestoneId);
if (!byKind('tasks-game-start', 'ms').every(X.reqOk)) die('里程碑齐了应算达成');
ok('物品 / 货币 / 通关 / 里程碑四类需求的达成判定都正确');

// 5) 提交扣掉需求物品与货币，并发放奖励
S.doneTasks = ['tasks-game-start'];
S.currency = 1000;
S.warehouse = [['nail', 20], ['iron-sheet', 10], ['wood-strip', 6]];
const t1 = X.TASKS['tasks-expand-storehouse-1'];
X.act({ dataset: { a: 'task-do', id: 'tasks-expand-storehouse-1' } });
if (!S0().doneTasks.includes('tasks-expand-storehouse-1')) die('提交后应记为已完成');
if (X.invQty('nail') !== 8) die(`钉子应从 20 扣到 8，实际 ${X.invQty('nail')}`);
if (X.invQty('iron-sheet') !== 2) die(`铁片应从 10 扣到 2，实际 ${X.invQty('iron-sheet')}`);
if (S0().currency !== 1000 - 800 + (t1.reward.currency || 0))
  die(`货币结算错误：${S0().currency}`);
const t2 = X.TASKS['tasks-pass-map-1'];
S0().doneTasks = []; S0().clearedMaps = ['map-1']; S0().warehouse = []; S0().currency = 0;
X.act({ dataset: { a: 'task-do', id: 'tasks-pass-map-1' } });
for (const [id, n] of Object.entries(t2.reward.items || {}))
  if (X.invQty(id) !== n) die(`奖励 ${id}×${n} 未入库，实际 ${X.invQty(id)}`);
if (S0().currency !== t2.reward.currency) die(`奖励货币未发放：${S0().currency}`);
ok('提交任务扣掉需求物品与货币，奖励货币与物品如数发放');

// 6) 扩容奖励要真的把仓库格子加上去
{
  const S = S0();
  S.doneTasks = ['tasks-game-start']; S.currency = 1000;
  S.warehouse = [['nail', 12], ['iron-sheet', 8], ['wood-strip', 4]];
  const before = X.whCap();
  X.act({ dataset: { a: 'task-do', id: 'tasks-expand-storehouse-1' } });
  const want = before + (X.TASKS['tasks-expand-storehouse-1'].reward.warehouseSlots || 0);
  if (X.whCap() !== want) die(`扩容奖励未生效：仓库上限 ${X.whCap()}，应为 ${want}`);
}
ok('仓储扩建任务的 warehouseSlots 奖励真的抬高了仓库上限');

// 7) 奖励放不下就不能提交（按扣完需求、加上扩容后的最终状态算）
{
  const S = S0();
  S.doneTasks = []; S.clearedMaps = ['map-1']; S.currency = 0;
  const cap = X.whCap();
  S.warehouse = Array.from({ length: cap }, (_, i) => [`__f${i}`, 1]);
  for (let i = 0; i < cap; i++) X.IT[`__f${i}`] = { name: `占位${i}`, rarity: 'common', weight: 0.1, value: 1, stack: 1, icon: '' };
  if (X.rewardFits(X.TASKS['tasks-pass-map-1'])) die('仓库全满时带物品奖励的任务不该判定为放得下');
  if (X.taskCanComplete('tasks-pass-map-1')) die('放不下时不该允许提交');
  S.warehouse.pop();
  if (!X.rewardFits(X.TASKS['tasks-pass-map-1'])) die('腾出一格后应能提交');
  for (let i = 0; i < cap; i++) delete X.IT[`__f${i}`];
}
ok('奖励物品放不下时禁止提交，腾出格子后恢复（按最终状态算，含扩容奖励）');

// 8) 标签页红点数 = 当前可提交的任务数
{
  const S = S0();
  S.doneTasks = []; S.currency = 0; S.warehouse = []; S.clearedMaps = []; S.milestones = [];
  if (X.claimable() !== 0) die(`什么都没达成时红点应为 0，实际 ${X.claimable()}`);
  S.clearedMaps = ['map-1'];
  if (X.claimable() !== 1) die(`应有 1 条可提交，实际 ${X.claimable()}`);
  S.stage = 'tasks'; X.render();
  const m = strip(X.el('mount').innerHTML).match(/tabdot">(\d+)</);
  if (!m) die('可提交时顶栏没有红点');
  else if (+m[1] !== X.claimable()) die(`红点显示 ${m[1]} ≠ 可提交数 ${X.claimable()}`);
  S.doneTasks = ['tasks-pass-map-1'];
  if (X.claimable() !== 0) die('提交后红点应归零');
}
ok('任务标签页红点数始终等于当前可提交的任务数');
end();
