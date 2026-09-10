import fs from 'node:fs';
const body = fs.readFileSync('prototypes/expedition-panel.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const mkEl=()=>({innerHTML:'',textContent:'',disabled:false,dataset:{},hidden:false,className:'',
  style:{setProperty(){}},querySelector:()=>mkEl(),querySelectorAll:()=>[],addEventListener(){},
  setAttribute(){},getAttribute:()=>null,appendChild:()=>{},
  getBoundingClientRect:()=>({left:0,top:0,right:60,bottom:60,width:60,height:60}),
  classList:{add(){},remove(){},toggle(){},contains:()=>false}});
const els={};
globalThis.window={innerWidth:1400,innerHeight:900};
globalThis.document={getElementById:id=>(els[id]??=mkEl()),createElement:()=>mkEl(),
  body:mkEl(),documentElement:mkEl(),querySelector:()=>mkEl(),querySelectorAll:()=>[]};
globalThis.getComputedStyle=()=>({getPropertyValue:()=>'#3f8f6a'});
globalThis.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),0);
new Function(body+';globalThis.__D={S:()=>S,reset,act,V,IT,dropCargo,'
  +'cargoW,ovPenalty,CAP_W,TIDY_STAGES,BAG_STAGES,canOpenBag,canDiscard,bagBtn,enterExtract};')();
const D=globalThis.__D;
let bad=0; const die=m=>{console.error('✗',m);bad++;};
const fresh=()=>{ D.reset(); const S=D.S(); S.pet='gugugaga'; S.node='m1-point-2'; return S; };
const btn=(a,d={})=>({dataset:{a,...d},__whole:false,disabled:false});

// 1) 背包入口在整个探险过程中常驻，出发前和结束后不出现
{
  const S=fresh();
  S.cargo=[['gear',2]];
  for(const st of ['travel','arrive','event','route']){
    S.stage=st; if(!D.canOpenBag()) die(`${st} 阶段应能打开背包`);
  }
  for(const st of ['pet','map','start','bag','settle','tasks']){
    S.stage=st; if(D.canOpenBag()) die(`${st} 阶段不该有背包入口`);
  }
  console.log('✓ 背包入口在 行进/抵达/事件/路线 全程常驻，出发前与战报页不出现');
}

// 2) 丢弃的开放阶段与引擎一致：traveling 只能看不能丢
{
  const S=fresh();
  const want=['arrive','event','route','extract'];
  if(JSON.stringify(D.TIDY_STAGES)!==JSON.stringify(want))
    die(`可丢弃阶段应为 ${want}，实为 ${D.TIDY_STAGES}`);
  S.stage='travel';
  if(D.canDiscard()) die('行进途中不该允许丢弃（引擎 traveling 会抛错）');
  if(!D.canOpenBag()) die('行进途中仍应能打开背包查看');
  S.cargo=[['gear',3]];
  D.act(btn('tidy-drop',{id:'gear',n:'1'}));
  if((S.cargo.find(x=>x[0]==='gear')||[,0])[1]!==3) die('行进途中的丢弃请求应被拒绝');
  console.log('✓ 行进途中能看不能丢，丢弃请求被挡下（与引擎 phase 限制一致）');
}

// 3) 超载时顶栏入口标红并写出风险加成
{
  const S=fresh(); S.stage='route';
  S.cargo=[['cast-iron-pan',3]];
  if(D.cargoW()<=D.CAP_W) die('前置条件失败：应处于超载');
  const html=D.bagBtn();
  if(!html.includes('over')) die('超载时入口应标红');
  if(!html.includes(`+${D.ovPenalty(D.cargoW())}`)) die('超载时应写出风险加成');
  S.cargo=[['gear',1]];
  if(D.bagBtn().includes('class="bagbtn over"')) die('不超载时不该标红');
  console.log(`✓ 顶栏入口在超载时标红并标注 +${D.ovPenalty(12)}，常态不标`);
}

// 4) 丢弃真的减少负重，并能把超载降回正常
{
  const S=fresh(); S.stage='route';
  S.cargo=[['cast-iron-pan',3]];
  const before=D.cargoW();
  if(before<=D.CAP_W) die('前置条件失败');
  const risk=D.ovPenalty(before);
  D.act(btn('tidy-drop',{id:'cast-iron-pan',n:'2'}));
  const after=D.cargoW();
  if(after>=before) die('丢弃后负重应下降');
  if(after>D.CAP_W) die('丢掉两件后应回到不超载');
  if(D.ovPenalty(after)>=risk) die('风险加成应随之下降');
  console.log(`✓ 丢弃降负重：${before} → ${after}，事件风险 +${risk} → +${D.ovPenalty(after)}`);
}

// 5) 只丢指定数量，不会误伤同格其余物品；丢空的条目要移除
{
  const S=fresh(); S.stage='route';
  S.cargo=[['gear',5],['honey',2]];
  D.dropCargo('gear',2);
  if((S.cargo.find(x=>x[0]==='gear')||[,0])[1]!==3) die('应只丢掉 2 个齿轮');
  if((S.cargo.find(x=>x[0]==='honey')||[,0])[1]!==2) die('不该动到其它物品');
  D.dropCargo('gear',99);   // 超量丢弃只丢现有的
  if(S.cargo.some(x=>x[0]==='gear')) die('丢光后条目应移除');
  if(S.cargo.some(([,q])=>q<=0)) die('不该留下 0 数量的条目');
  console.log('✓ 按量丢弃、超量截断、丢光后条目移除，其它物品不受影响');
}

// 6) 丢光后浮层自动收起
{
  const S=fresh(); S.stage='route';
  S.cargo=[['gear',1]]; S.tidy=true;
  D.act(btn('tidy-drop',{id:'gear',n:'1'}));
  if(S.tidy) die('背包丢空后浮层应自动关闭');
  console.log('✓ 背包丢空后浮层自动收起');
}
process.exit(bad?1:0);
