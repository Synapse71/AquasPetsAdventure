// 事件选项的情报分档：内容必须逐字对齐引擎 getRiskPreview()
import { loadProto, catalog, strip, reporter } from './_stub.mjs';
const X = loadProto('prototypes/expedition-panel.html',
  'S:()=>S,EVENTS,evRes,riskOf,riskPreview,outcomeProbs,riskBand,TEAM_SEC,SEC_CN,tier');
// S 是 let，reset() 会重新赋值——每次都从 getter 取，别缓存旧引用
const S = X.S();
const { die, ok, end } = reporter();

// 1) 四档概率分布与引擎的枚举法一致
for (const adv of [false, true]) for (let score = -8; score <= 12; score++) {
  const p = X.outcomeProbs(score, adv);
  const sum = p.extraSuccess + p.success + p.failure + p.bigFailure;
  if (Math.abs(sum - 1) > 1e-9) die(`score=${score} adv=${adv} 概率和 ${sum}`);
  const rolls = [];
  if (adv) { for (let a=1;a<=6;a++) for (let b=1;b<=6;b++) rolls.push(Math.max(a,b)); }
  else rolls.push(1,2,3,4,5,6);
  const c = {e:0,s:0,f:0,b:0};
  for (const r of rolls) { const m = r - score;
    if (m>=6) c.e++; else if (m>=3) c.s++; else if (m>=0) c.f++; else c.b++; }
  if (Math.abs(p.extraSuccess - c.e/rolls.length) > 1e-9
   || Math.abs(p.bigFailure  - c.b/rolls.length) > 1e-9)
    die(`score=${score} adv=${adv} 分档计数不符`);
}
ok('四档概率分布与引擎枚举法一致（单骰 6 面 / 优势骰 36 组合，score −8..12）');

// 2) riskBand 看的是「大失败」概率，边界要卡准
for (const [p, want] of [[0,'稳妥'],[0.0001,'冒险'],[0.3,'冒险'],[0.3001,'危险'],
                         [0.5999,'危险'],[0.6,'极其危险'],[1,'极其危险']])
  if (X.riskBand(p) !== want) die(`riskBand(${p}) = ${X.riskBand(p)} ≠ ${want}`);
ok('riskBand 四档边界与引擎一致（看的是大失败概率）');

// 3) 三档情报暴露的内容，逐字对照引擎规格
const spec = (ch, t) => {
  const r = X.evRes(ch);
  if (r.type === 'secondary') {
    const cur = X.TEAM_SEC[r.stat], nm = X.SEC_CN[r.stat];
    if (t === 3) return `成功条件 · ${nm}达到 ${r.successThreshold}`;
    if (cur < r.successThreshold) return t === 1 ? `${nm}不足` : `需要${nm}达到 ${r.successThreshold}`;
    return '';
  }
  if (r.type === 'leave') return '安全离开';
  if (t === 1) return '风险未知';
  return X.riskBand(X.outcomeProbs(X.riskOf(ch), false).bigFailure);
};
let n = 0;
for (const [eid, ev] of Object.entries(X.EVENTS)) {
  S.evtId = eid;
  for (const t of [1,2,3]) {
    S.intel = t;
    for (const ch of ev.choices) {
      const pv = X.riskPreview(ch);
      const got = pv.lines.length ? pv.lines[0].t : '';
      if (got !== spec(ch, t)) die(`${eid}/${ch.id} 档${t}: "${got}" ≠ "${spec(ch,t)}"`);
      n++;
    }
  }
}
ok(`${n} 组（${Object.keys(X.EVENTS).length} 事件 × 3 档）情报文案与引擎规格逐字一致`);

// 4) 情报缺失档绝不能泄漏具体概率——分档的意义全在这里
S.intel = 1;
for (const [eid, ev] of Object.entries(X.EVENTS)) {
  S.evtId = eid;
  for (const ch of ev.choices) {
    const txt = X.riskPreview(ch).lines.map(l => l.rows ? l.rows.flat().join(' ') : l.t).join(' ');
    if (X.evRes(ch).type === 'primary' && /%/.test(txt))
      die(`${eid}/${ch.id} 情报缺失档泄漏了概率数字`);
  }
}
ok('情报缺失档下没有任何一条泄漏具体概率');

// 5) 并列的成功线 / 大成功线：同为标题、同颜色
S.intel = 3;
let par = 0;
for (const [eid, ev] of Object.entries(X.EVENTS)) {
  S.evtId = eid;
  for (const ch of ev.choices) {
    if (X.evRes(ch).type !== 'secondary') continue;
    const ls = X.riskPreview(ch).lines;
    if (ls.length !== 2) { die(`${eid}/${ch.id} 完整情报下应有两行`); continue; }
    if (!ls[0].head || !ls[1].head) die(`${eid}/${ch.id} 并列两行必须同为标题`);
    if ((ls[0].v||'') !== (ls[1].v||'')) die(`${eid}/${ch.id} 并列两行颜色必须一致`);
    par++;
  }
}
ok(`${par} 个次要属性选项的成功线 / 大成功线两行同为标题、同颜色`);

// 6) 部分情报档给的是受伤程度白话，不含百分比
S.intel = 2;
const DESC = {稳妥:'不会受伤', 冒险:'有小概率受伤', 危险:'有大概率受伤', 极其危险:'有极大概率受伤'};
let nb = 0;
for (const [eid, ev] of Object.entries(X.EVENTS)) {
  S.evtId = eid;
  for (const ch of ev.choices) {
    if (X.evRes(ch).type !== 'primary') continue;
    const ls = X.riskPreview(ch).lines;
    if (ls[1].t !== DESC[ls[0].t]) die(`${eid}/${ch.id} 档2「${ls[0].t}」描述应为「${DESC[ls[0].t]}」`);
    if (/%/.test(ls[1].t)) die(`${eid}/${ch.id} 档2 泄漏了概率`);
    nb++;
  }
}
ok(`${nb} 个主属性选项在部分情报档下给的是受伤程度描述，不含概率`);

// 7) 完整情报下四档概率各占一行、合计 100%
S.intel = 3;
let nr = 0;
for (const [eid, ev] of Object.entries(X.EVENTS)) {
  S.evtId = eid;
  for (const ch of ev.choices) {
    if (X.evRes(ch).type !== 'primary') continue;
    const grid = X.riskPreview(ch).lines.find(l => l.rows);
    if (!grid) { die(`${eid}/${ch.id} 完整情报下缺概率明细`); continue; }
    const keys = grid.rows.map(r => r[0]).join(',');
    if (keys !== '大成功,成功,失败,大失败') die(`${eid}/${ch.id} 四档顺序不对：${keys}`);
    const sum = grid.rows.reduce((t, r) => t + parseFloat(r[1]), 0);
    if (Math.abs(sum - 100) > 0.3) die(`${eid}/${ch.id} 四档概率和为 ${sum}`);
    nr++;
  }
}
ok(`${nr} 个主属性选项的四档概率各占一行、合计 100%`);
end();
