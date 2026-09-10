import fs from 'node:fs';
const body = fs.readFileSync('prototypes/settings-panel.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const mkEl=()=>({innerHTML:'',textContent:'',dataset:{},style:{},value:'',
  classList:{add(){},remove(){},toggle(){},contains:()=>false},
  querySelector:()=>mkEl(),querySelectorAll:()=>[],addEventListener(){},setAttribute(){},
  insertAdjacentHTML(){},remove(){},
  getBoundingClientRect:()=>({left:0,top:0,right:760,bottom:614,width:760,height:614})});
const els={};
globalThis.window={innerWidth:1400,innerHeight:900};
globalThis.document={getElementById:id=>(els[id]??=mkEl()),createElement:()=>mkEl(),
  body:mkEl(),documentElement:mkEl(),querySelector:()=>mkEl(),querySelectorAll:()=>[]};
globalThis.getComputedStyle=()=>({getPropertyValue:()=>'#000'});
new Function(body+';globalThis.__S={S:()=>S,view,act,render,bodyW,bubSize,BUB_MIN,'
  +'CANVAS_MIN,CANVAS_MAX,BODY_RATIO,GAP,BUBS,confirmHTML};')();
const X=globalThis.__S, S=X.S();
let bad=0; const die=m=>{console.error('✗',m);bad++;};
const strip=h=>h.replace(/src="data:[^"]*"/g,'src=""');

// 1) 尺寸公式必须和 pet-menu.html 里的 CSS 变量完全一致
{
  const menu=fs.readFileSync('prototypes/pet-menu.html','utf8');
  const ratio=menu.match(/--body:calc\(var\(--canvas\) \* \.(\d+)\)/);
  const gap=menu.match(/--gap:(\d+)px/);
  const bub=menu.match(/--bubsize:calc\(\(var\(--body\) - (\d+) \* var\(--gap\)\) \/ (\d+)\)/);
  if(!ratio||!gap||!bub) die('没能从 pet-menu 解析出尺寸公式');
  else {
    const r=Number('0.'+ratio[1]), g=+gap[1], n=+bub[2];
    if(X.BODY_RATIO!==r) die(`本体比例 ${X.BODY_RATIO} ≠ 菜单里的 ${r}`);
    if(X.GAP!==g) die(`间距 ${X.GAP} ≠ 菜单里的 ${g}`);
    if(X.BUBS!==n) die(`气泡数 ${X.BUBS} ≠ 菜单里的 ${n}`);
    if(+bub[1]!==n-1) die('气泡公式里的间距个数应为 气泡数 − 1');
    console.log(`✓ 尺寸公式与 pet-menu 的 CSS 变量一致（本体 ×${r}、间距 ${g}px、${n} 颗）`);
  }
}

// 2) 默认画布 300 要还原出文档里记的 141px 本体 / 25px 气泡
{
  if(Math.round(X.bodyW(300))!==141) die(`画布 300 的本体应为 141px，实为 ${X.bodyW(300)}`);
  if(Math.abs(X.bubSize(300)-25)>0.01) die(`画布 300 的气泡应为 25px，实为 ${X.bubSize(300)}`);
  console.log('✓ 画布 300px → 本体 141px → 气泡 25px，与文档记载吻合');
}

// 3) 菜单总宽恒等于本体宽——这是那条铁律
{
  for(let c=X.CANVAS_MIN;c<=X.CANVAS_MAX;c+=10){
    const menuW=X.bubSize(c)*X.BUBS+X.GAP*(X.BUBS-1);
    if(Math.abs(menuW-X.bodyW(c))>1e-6)
      die(`画布 ${c}: 菜单宽 ${menuW.toFixed(2)} ≠ 本体宽 ${X.bodyW(c).toFixed(2)}`);
  }
  console.log(`✓ 画布 ${X.CANVAS_MIN}~${X.CANVAS_MAX} 全程：菜单总宽恒等于本体宽`);
}

// 4) 气泡小到不可用时要警告，而不是默默让图标糊掉
{
  S.canvas=X.CANVAS_MIN;
  const small=X.bubSize(S.canvas);
  let html=strip(X.view());
  if(small<X.BUB_MIN && !html.includes('低于可用下限')) die('气泡低于下限时应给出警告');
  S.canvas=300;
  html=strip(X.view());
  if(html.includes('低于可用下限')) die('常态不该报警告');
  console.log(`✓ 画布拉到最小时气泡 ${small.toFixed(1)}px，低于 ${X.BUB_MIN}px 下限会明确警告`);
}

// 5) 清档要二次确认，取消不生效
{
  S.confirm=null;
  X.act('wipe');
  if(S.confirm!=='wipe') die('点清档应先弹确认');
  if(!strip(X.confirmHTML()).includes('无法找回')) die('确认层要写明不可逆');
  X.act('cancel');
  if(S.confirm) die('取消后确认层应关闭');
  X.act('wipe'); X.act('wipe-yes');
  if(S.confirm) die('确认后确认层应关闭');
  if(!S.toast.includes('清空')) die('清档后应有反馈');
  console.log('✓ 清档二次确认：先弹层、可取消、确认后才执行');
}

// 6) 开关与滑块的状态真的在变
{
  S.onTop=true; S.autoStart=false;
  let html=strip(X.view());
  if(!/data-sw="onTop" aria-pressed="true"/.test(html)) die('置顶开关状态没渲染对');
  if(!/data-sw="autoStart" aria-pressed="false"/.test(html)) die('自启开关状态没渲染对');
  S.volume=0; html=strip(X.view());
  if(!html.includes('value="0"')) die('音量 0 没渲染对');
  console.log('✓ 开关与滑块的状态如实反映在渲染结果里');
}
process.exit(bad?1:0);
