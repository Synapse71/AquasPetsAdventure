#!/usr/bin/env node
// 原型冒烟测试：真执行 <script>，并逐阶段渲染视图。
// 教训：new Function() 只解析不执行，TDZ / 未定义变量这类运行错误抓不到，
// 曾因此把一个白屏的原型当"完成"发布出去。发布前必须跑这个。
import fs from 'node:fs';
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const m = src.match(/<script>([\s\S]*)<\/script>/);
// 纯静态页（如素材总览）没有脚本，不是缺陷，直接放行
if (!m) { console.log('· 纯静态页，无脚本可执行，跳过'); process.exit(0); }
const body = m[1];
// DOM 桩要覆盖页面实际用到的 API。桩太弱会让真实错误漏过去——
// 曾因缺 createElement / classList.remove 而误报失败。
const mkEl = () => ({ tagName:'DIV', id:'', innerHTML:'', className:'',
  textContent:'', disabled:false, offsetWidth:104, dataset:{},
  style:{ setProperty(){} },
  querySelector: () => mkEl(), querySelectorAll: () => [],
  addEventListener(){}, removeEventListener(){},
  setAttribute(){}, removeAttribute(){}, getAttribute: () => null,
  appendChild(){}, removeChild(){}, focus(){}, setSelectionRange(){},
  insertAdjacentHTML(){}, remove(){},
  getBoundingClientRect: () => ({ left:0, top:0, width:760, height:506,
    bottom:506, right:760 }),
  classList:{ add(){}, remove(){}, toggle(){}, contains: () => false } });
const els = {};
globalThis.window = globalThis.window || { innerWidth:1400, innerHeight:900,
  addEventListener(){}, removeEventListener(){}, matchMedia:()=>({matches:false, addEventListener(){}}) };
globalThis.document = { getElementById: id => (els[id] ??= mkEl()),
  createElement: () => mkEl(), body: mkEl(), documentElement: mkEl(),
  querySelector: () => mkEl(), querySelectorAll: () => [] };
// 动画类原型要跑真实的 rAF 循环，光解析不够。
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#3f8f6a' });
globalThis.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 0);
try {
  new Function(body + ';globalThis.__H={S:()=>S,V:typeof V!=="undefined"?V:null'
    + ',R:typeof rollOne!=="undefined"?rollOne:null'
    + ',D:typeof doRoll!=="undefined"?doRoll:null'
    + ',E:typeof EVENTS!=="undefined"?EVENTS:null};')();
} catch (e) { console.error('✗ 顶层执行失败:', e.message); process.exit(1); }
console.log('✓ 顶层执行 + 初始渲染');
const H = globalThis.__H;
if (H.V) {                        // 逐阶段渲染（探险面板）
  const S = H.S();
  S.pet = 'gugugaga'; S.node = 'm1-point-2'; S.visited = 2; S.xp = 20;
  S.cargo = [['gear',1],['honey',1]]; S.arrival = [['caviar',1]];
  S.travelLabel = '测试'; S.travelDur = 1000; S.travelEnd = Date.now()+1e6;
  let bad = 0;
  for (const k of Object.keys(H.V)) {
    S.stage = k; S.evtOutcome = null; S.evtDone = false;
    try { H.V[k](); } catch (e) { console.error(`✗ 阶段 ${k}:`, e.message); bad++; }
    if (k === 'event' && H.E) {   // 事件要把每个事件的每个选项 × 三个子步骤都走一遍
      for (const [eid, ev] of Object.entries(H.E)) {
        S.evtId = eid;
        for (const ch of ev.choices) {
          S.evtChoice = ch.id;
          for (const st of ['choose', 'judge', 'result']) {
            S.evtStep = st;
            S.evtRoll = st === 'choose' ? 0 : 4;
            S.evtRolls = st === 'choose' ? null : [4];
            S.evtOutcome = st === 'choose' ? null : 'success';
            S.evtReward = st === 'result' ? { paper: 1 } : null;
            try { H.V[k](); }
            catch (e) { console.error(`✗ 事件 ${eid}/${ch.id}/${st}:`, e.message); bad++; }
          }
        }
      }
      S.evtStep = 'choose'; S.evtChoice = null; S.evtOutcome = null;
      const n = Object.values(H.E).reduce((t, e) => t + e.choices.length, 0);
      if (!bad) console.log(`  · 事件阶段：${Object.keys(H.E).length} 个事件 / ${n} 个选项 × 三步全部渲染通过`);
    }
  }
  bad ? process.exit(1) : console.log(`✓ ${Object.keys(H.V).length} 个阶段视图全部渲染通过`);
}
if (H.R) {                        // 掷骰动画：真跑一遍 rAF 循环到收尾
  try { await H.R(mkEl(), 3, 60, 6); console.log('✓ 掷骰动画循环跑到收尾'); }
  catch (e) { console.error('✗ 掷骰动画:', e.message); process.exit(1); }
}
if (H.D) {                        // 四档结果各结算一次
  const S = H.S();
  for (const [d, st] of [[9,0],[5,1],[2,3],[0,9]]) {
    S.diff = d; S.stat = st; S.speed = 0.02;
    for (const adv of [false, true]) {
      S.adv = adv;
      try { await H.D(); }
      catch (e) { console.error(`✗ 结算 难度${d}/属性${st}/优势${adv}:`, e.message); process.exit(1); }
    }
  }
  console.log('✓ 四档结果 × 单骰/优势骰 结算全部通过');
}
// 原型里有长周期的 setTimeout 循环（待机动作调度），不显式退出进程会一直挂着
process.exit(0);
