#!/usr/bin/env node
// 校验原型里的事件判定分档是否跟 src/domain/engine.ts 一致。
//   node tools/rule_sync.mjs
// 引擎的分档阈值改过好几次（≥7/≥2 → ≥6/≥3），而同一个数字散落在
// 判定函数、概率枚举、成功门槛、页面文案四处，漏改一处就会出现
// 「色带显示会成功、掷完却判失败」这种对不上的表现。
// 这里把引擎源码当唯一事实来源，直接从中抠出阈值再逐个文件比对。
import fs from 'node:fs';
const eng = fs.readFileSync('src/domain/engine.ts','utf8');
let bad=0; const die=m=>{console.error('✗',m);bad++;};

// 运行时判定、概率枚举和 React 色带共用 primaryOutcomeForRoll。
const helper = eng.slice(eng.indexOf('export function primaryOutcomeForRoll'), eng.indexOf('export function eventCheckRisk'));
const nums = [...helper.matchAll(/margin >= (\d+)/g)].map(m => +m[1]);
const a = { extra: nums[0], success: nums[1], fail: nums[2] };
if (nums.length !== 3) die('共享分档函数解析失败');
for (const name of ['function primaryOutcomeProbabilities', 'export function resolveEvent']) {
  const start = eng.indexOf(name), end = eng.indexOf('\n}', start);
  if (!eng.slice(start, end).includes('primaryOutcomeForRoll(')) die(name + ' 未调用共享分档函数');
}
console.log(`引擎共享分档：大成功 ≥${a.extra} / 成功 ≥${a.success} / 失败 ≥${a.fail}`);

const files = ['prototypes/expedition-panel.html','prototypes/dice-roll.html',
               'prototypes/archive/dice-roll-v2-cube.html'];
for(const f of files){
  const src = fs.readFileSync(f,'utf8');
  const nums = [...src.matchAll(/m\s*>=\s*(\d+)\s*\?\s*"extra-success"|m >= (\d+)\) return "extra-success"|if\(m>=(\d+)\) c\.extraSuccess/g)]
    .map(m => +(m[1]??m[2]??m[3]));
  if(!nums.length) { die(`${f} 找不到分档代码`); continue; }
  for(const n of nums) if(n!==a.extra) die(`${f} 大成功阈值 ${n} ≠ 引擎 ${a.extra}`);
  const sn = [...src.matchAll(/m\s*>=\s*(\d+)\s*\?\s*"success"|m >= (\d+)\) return "success"|else if\(m>=(\d+)\) c\.success/g)]
    .map(m => +(m[1]??m[2]??m[3]));
  for(const n of sn) if(n!==a.success) die(`${f} 成功阈值 ${n} ≠ 引擎 ${a.success}`);
  // 掷骰原型里的「成功需要 ≥N 点」门槛 = risk + 成功阈值
  const th = src.match(/const th = risk\(\) \+ (\d+);/);
  if(th && +th[1]!==a.success) die(`${f} 成功门槛 risk+${th[1]} ≠ risk+${a.success}`);
  console.log(`✓ ${f} 分档与引擎一致`);
}
process.exit(bad?1:0);
