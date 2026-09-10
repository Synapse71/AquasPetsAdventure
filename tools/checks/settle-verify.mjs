import fs from 'node:fs';
const body = fs.readFileSync('prototypes/expedition-panel.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const mkEl=()=>({innerHTML:'',textContent:'',disabled:false,offsetWidth:104,dataset:{},hidden:false,
  className:'',style:{setProperty(){}},querySelector:()=>mkEl(),querySelectorAll:()=>[],
  addEventListener(){},setAttribute(){},getAttribute:()=>null,appendChild:()=>{},
  getBoundingClientRect:()=>({left:0,top:0,right:60,bottom:60,width:60,height:60}),
  classList:{add(){},remove(){},toggle(){},contains:()=>false}});
const els={};
globalThis.window={innerWidth:1400,innerHeight:900};
globalThis.document={getElementById:id=>(els[id]??=mkEl()),createElement:()=>mkEl(),
  body:mkEl(),documentElement:mkEl(),querySelector:()=>mkEl(),querySelectorAll:()=>[]};
globalThis.getComputedStyle=()=>({getPropertyValue:()=>'#3f8f6a'});
globalThis.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),0);
new Function(body+';globalThis.__S={S:()=>S,reset,act,V,IT,itemRow,enterExtract};')();
const X=globalThis.__S;
let bad=0; const die=m=>{console.error('✗',m);bad++;};
// money() 里嵌着很长的 base64 图标，比对前先剥掉，否则截取窗口永远够不到数字
const strip=h=>h.replace(/src="data:[^"]*"/g,'src=""');

// 1) 战报物品行给的是售卖价值，不是重量
{
  X.reset(); const S=X.S();
  S.banked=[['caviar',1]];
  const row=X.itemRow('caviar',1,'','value');
  const w=(X.IT['caviar'].weight*1).toFixed(1), v=X.IT['caviar'].value;
  if(row.includes(`>${w}<`)) die('战报行仍在显示重量');
  if(!row.includes(String(v))) die(`战报行应显示售卖价值 ${v}`);
  // 事件结果页那条链路必须还是重量
  const wRow=X.itemRow('caviar',1);
  if(!wRow.includes(`>${w}<`)) die('默认（事件奖励）应仍显示重量');
  console.log(`✓ 战报行显示售卖价值 ${v}，事件奖励行仍显示重量 ${w}`);
}

// 2) 数量要乘进去：×4 的价值是单价的 4 倍
{
  const one=X.itemRow('chocolate',1,'','value'), four=X.itemRow('chocolate',4,'','value');
  const v=X.IT['chocolate'].value;
  if(!one.includes(String(v))) die(`单件应为 ${v}`);
  if(!four.includes(String(v*4))) die(`4 件应为 ${v*4}`);
  console.log(`✓ 价值按数量累乘：${v} → ${v*4}`);
}

// 3) 入库价值 + 售卖所得 = 总计收益，且三项都出现在战报里
{
  X.reset(); const S=X.S();
  S.banked=[['caviar',1],['chocolate',4],['gold-necklace',1]];
  S.sold=641; S.visited=3; S.xp=30; S.stage='settle';
  const want=S.banked.reduce((t,[id,q])=>t+X.IT[id].value*q,0);
  const html=strip(X.V.settle().body);
  for(const label of ['入库战利品价值','就地售卖所得','总计收益'])
    if(!html.includes(label)) die(`战报缺少「${label}」`);
  const idx=[html.indexOf('入库战利品价值'),html.indexOf('就地售卖所得'),html.indexOf('总计收益')];
  if(idx[0]>idx[1]||idx[1]>idx[2]) die('三项顺序应为 入库价值 → 售卖所得 → 总计收益');
  const seg=html.slice(html.indexOf('总计收益'), html.indexOf('总计收益')+200);
  if(!seg.includes(String(want+S.sold)))
    die(`总计应为 ${want}+${S.sold}=${want+S.sold}，实际段落：${seg.replace(/<[^>]*>/g,' ').trim()}`);
  console.log(`✓ 入库价值 ${want} + 售卖所得 ${S.sold} = 总计 ${want+S.sold}，三项顺序正确`);
}

// 4) 没有入库物品时，入库价值为 0、总计等于售卖所得
{
  X.reset(); const S=X.S();
  S.banked=[]; S.sold=200; S.stage='settle';
  const html=strip(X.V.settle().body);
  if(!html.includes('（没有入库物品）')) die('空入库应有占位文案');
  const seg=html.slice(html.indexOf('总计收益'), html.indexOf('总计收益')+200);
  if(!seg.includes('200')) die('全部售卖时总计应等于售卖所得');
  console.log('✓ 全部售卖（无入库）时总计等于售卖所得');
}
process.exit(bad?1:0);
