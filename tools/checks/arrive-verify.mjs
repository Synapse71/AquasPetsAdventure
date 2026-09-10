// 抵达节点与撤离点：起点是引擎里的特例，撤离点必须严格跟 catalog 走
import { loadProto, catalog, strip, reporter } from './_stub.mjs';
const X = loadProto('prototypes/expedition-panel.html',
  'S:()=>S,MAP,arriveNow,canExtractHere,goNext,phaseLabel,render,el:id=>document.getElementById(id)');
const { die, ok, end } = reporter();
const cat = catalog();
const cmap = cat.maps['map-1'];
const cnode = id => cmap.nodes[id];
const S = X.S(), MAP = X.MAP;
const go = id => { S.node = null; S.travelTo = id; X.arriveNow(); };

// 1) 起点首访：没有战利品环节，也不计节点数与经验（engine.ts 的 startNodeId 分支）
S.visited = 0; S.xp = 0;
go(MAP.start);
if (S.stage !== 'route') die(`起点首访应直接进选路线，实际 ${S.stage}`);
if (S.arrival.length) die('起点不应产出战利品');
if (S.visited !== 0) die(`起点不该计入已探节点，visited=${S.visited}`);
if (S.xp !== 0) die(`起点不该给节点经验，xp=${S.xp}`);
ok('起点首访跳过战利品环节，不计节点数、不给经验');

// 2) 原型的起点 id 与 catalog 的 startNodeId 一致，且该节点没配 loot
if (MAP.start !== cmap.startNodeId) die(`起点 ${MAP.start} ≠ catalog ${cmap.startNodeId}`);
if (cnode(MAP.start).loot) die('catalog 里起点竟配了 loot，起点特例的前提变了');
if (MAP.nodes[MAP.start].loot) die('原型起点配了 loot');
ok(`起点 ${MAP.start} 与 catalog 的 startNodeId 一致，两侧都没配战利品`);

// 3) 非起点节点必须有战利品，且抵达后停在 arrive 页
let n3 = 0;
for (const id of Object.keys(MAP.nodes)) {
  if (id === MAP.start) continue;
  S.visited = 1; S.xp = 0;
  go(id);
  if (!MAP.nodes[id].loot?.length) { die(`${id} 没配 loot`); continue; }
  if (S.stage !== 'arrive') die(`${id} 抵达后应停在 arrive，实际 ${S.stage}`);
  if (S.xp !== 10) die(`${id} 应给 10 点节点经验，实际 ${S.xp}`);
  n3++;
}
ok(`${n3} 个非起点节点都配了战利品、抵达后进拾取页并给经验`);

// 4) 撤离点逐节点比对 catalog：只有 terminal / extractable 为真才可撤离
for (const id of Object.keys(MAP.nodes)) {
  const c = cnode(id);
  if (!c) { die(`原型多出一个 catalog 里没有的节点 ${id}`); continue; }
  const want = id === cmap.startNodeId ? false : !!(c.terminal || c.extractable);
  S.node = id;
  if (X.canExtractHere() !== want)
    die(`${id} 可撤离判定 ${X.canExtractHere()} ≠ catalog 的 ${want}`);
}
ok(`${Object.keys(MAP.nodes).length} 个节点的可撤离判定与 catalog 的 terminal/extractable 逐一相符`);

// 5) 起点、营地、树洞都不是撤离点——这三处曾误显示过撤离选项
for (const id of ['m1-start', 'm1-point-1', 'm1-point-2']) {
  S.node = id;
  if (X.canExtractHere()) die(`${MAP.nodes[id].name}(${id}) 不该出现撤离选项`);
}
S.node = 'm1-goal-1';
if (!X.canExtractHere()) die('终点克格纳应当可撤离');
ok('起点 / 探险者营地 / 不起眼的树洞均不可撤离，仅终点克格纳可撤离');

// 6) 抵达页标题带地名
S.visited = 1;
for (const id of Object.keys(MAP.nodes)) {
  if (id === MAP.start) continue;
  go(id);
  const want = `抵达地点 - ${MAP.nodes[id].name}`;
  if (X.phaseLabel() !== want) die(`标题 "${X.phaseLabel()}" ≠ "${want}"`);
  if (!strip(X.el('mount').innerHTML).includes(want)) die(`${id} 渲染结果里没有标题 "${want}"`);
}
ok('抵达页标题为「抵达地点 - 地名」，且真的渲染进了顶栏');

// 7) goNext 的分支优先级：先事件、终点转撤离、其余选路线
for (const id of Object.keys(MAP.nodes)) {
  const n = MAP.nodes[id];
  S.node = id; S.evtDone = false; S.stage = 'arrive';
  X.goNext();
  const want = n.event ? 'event' : n.terminal ? 'extract' : 'route';
  if (S.stage !== want) die(`${id} goNext 应到 ${want}，实际 ${S.stage}`);
  if (n.event) {                     // 事件做完再走一次，应落到后续分支
    S.evtDone = true; X.goNext();
    const w2 = n.terminal ? 'extract' : 'route';
    if (S.stage !== w2) die(`${id} 事件结束后应到 ${w2}，实际 ${S.stage}`);
  }
}
ok('goNext 分支优先级正确：未结事件 > 终点撤离 > 选择路线');
end();
