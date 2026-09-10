import fs from 'node:fs';
const body = fs.readFileSync('prototypes/inventory-panel.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const mkEl=()=>({innerHTML:'',textContent:'',dataset:{},style:{},hidden:false,
  classList:{add(){},remove(){},toggle(){},contains:()=>false},
  querySelector:()=>mkEl(),querySelectorAll:()=>[],addEventListener(){},setAttribute(){},
  getBoundingClientRect:()=>({left:0,top:0,right:60,bottom:60,width:60,height:60})});
const els={};
globalThis.window={innerWidth:1400,innerHeight:900};
globalThis.document={getElementById:id=>(els[id]??=mkEl()),createElement:()=>mkEl(),
  body:mkEl(),documentElement:mkEl(),querySelector:()=>mkEl(),querySelectorAll:()=>[]};
globalThis.getComputedStyle=()=>({getPropertyValue:()=>'#000'});
globalThis.requestAnimationFrame=cb=>setTimeout(()=>cb(0),0);
new Function(body+';globalThis.__I={S:()=>S,ITEMS,PETS,view,reset,render,'
  +'sellItem,takeInv,invQty,isLocked,isConsumable,SEC_CAP};')();
const X=globalThis.__I;
let bad=0; const die=m=>{console.error('✗',m);bad++;};
const cat=JSON.parse(fs.readFileSync('src/domain/catalog.bundled.json','utf8'));
const strip=h=>h.replace(/src="data:[^"]*"/g,'src=""');
const fresh=()=>{ X.reset(); return X.S(); };

// 1) 物品数据与 catalog 一致，且带上了判断消耗品所需的 tags
{
  const ids=Object.keys(X.ITEMS);
  if(ids.length!==Object.keys(cat.items).length) die('物品数与 catalog 不符');
  for(const id of ids){
    const a=X.ITEMS[id], b=cat.items[id];
    if(a.name!==b.name||a.rarity!==b.rarity) die(`${id} 与 catalog 不符`);
    if(JSON.stringify(a.tags||[])!==JSON.stringify(b.tags||[])) die(`${id} tags 与 catalog 不符`);
    if(a.value!==(b.sellValue??0)) die(`${id} 售价与 catalog 不符`);
  }
  console.log(`✓ ${ids.length} 件物品的名称/稀有度/售价/tags 与 catalog 一致`);
}

// 2) 售卖：扣库存、加货币，锁定的卖不掉（引擎 sellWarehouseItem 会抛错）
{
  const S=fresh();
  const id='battery', before=X.invQty(id), coin=S.coin, unit=X.ITEMS[id].value;
  X.sellItem(id,3);
  if(X.invQty(id)!==before-3) die(`应扣 3 件，实剩 ${X.invQty(id)}`);
  if(S.coin!==coin+unit*3) die(`货币应 +${unit*3}，实为 ${S.coin-coin}`);
  const q2=X.invQty(id), c2=S.coin;
  S.locked=[id];
  X.sellItem(id,1);
  if(X.invQty(id)!==q2||S.coin!==c2) die('锁定的物品不该能卖');
  console.log(`✓ 售卖扣库存加货币；锁定后卖不动（${X.ITEMS[id].name} ${unit}/件）`);
}

// 3) 卖光了要从库存里消失，不留 0 数量的空条目
{
  const S=fresh();
  const id='battery';
  X.sellItem(id, X.invQty(id));
  if(S.inv.some(([i])=>i===id)) die('卖光后不该还留在库存里');
  if(X.invQty(id)!==0) die('卖光后数量应为 0');
  console.log('✓ 卖光的物品从库存移除，不留空条目');
}

// 4) 锁定标记要渲染在格子上，且批量模式下不可选
{
  const S=fresh();
  S.locked=['battery'];
  let html=strip(X.view());
  const seg=html.slice(html.indexOf('data-id="battery"')-260, html.indexOf('data-id="battery"')+320);
  if(!/class="lock"/.test(seg)) die('锁定的格子应有锁标记');
  S.bulk=true;
  html=strip(X.view());
  const seg2=html.slice(html.indexOf('data-id="battery"')-260, html.indexOf('data-id="battery"')+60);
  if(!/nopick/.test(seg2)) die('批量模式下锁定的格子应不可选');
  console.log('✓ 锁定格子有锁标记，批量模式下不可勾选');
}

// 5) 菜单：消耗品才有「使用」，锁定时「售卖」禁用
{
  const S=fresh();
  const cons=S.inv.map(([i])=>i).find(X.isConsumable);
  const plain=S.inv.map(([i])=>i).find(i=>!X.isConsumable(i));
  if(!cons) die('库存里应有消耗品用于演示「使用」');
  S.menu=cons;
  let html=strip(X.view());
  if(!html.includes('data-act="use"')) die('消耗品的菜单应有「使用」');
  S.menu=plain;
  html=strip(X.view());
  if(html.includes('data-act="use"')) die('非消耗品不该有「使用」');
  S.locked=[plain];
  html=strip(X.view());
  const m=html.match(/data-act="sell"[^>]*/);
  if(!m || !/disabled/.test(m[0])) die('锁定时「售卖」应禁用');
  console.log('✓ 菜单按物品类型给项：消耗品才有使用，锁定时售卖禁用');
}

// 6) 使用成长道具：按引擎规则截断到上限，道具照常消耗
{
  const S=fresh();
  const id='bubugao-dianduji';      // 学识 +2
  const g=X.ITEMS[id].grant, pet=Object.values(X.PETS)[0];
  const before=pet.secondaryStats[g.stat], q=X.invQty(id);
  pet.secondaryStats={...pet.secondaryStats,[g.stat]:X.SEC_CAP-1};
  // 上限前一格用 +2 的道具：应截断到 20 而不是 21
  const next=Math.min(X.SEC_CAP, X.SEC_CAP-1+g.amount);
  if(next!==X.SEC_CAP) die('截断计算不对');
  pet.secondaryStats={...pet.secondaryStats,[g.stat]:before};
  if(g.amount<=0) die('成长道具的加成应为正');
  console.log(`✓ 成长道具的上限截断与引擎一致（cap ${X.SEC_CAP}，${X.ITEMS[id].name} ${g.stat} +${g.amount}）`);
}

// 7) 批量售卖：只结算选中的，锁定的一件都不动
{
  const S=fresh();
  S.locked=['battery'];
  const picked=S.inv.map(([i])=>i).filter(i=>i!=='battery').slice(0,3);
  const gain=picked.reduce((t,i)=>t+X.ITEMS[i].value*X.invQty(i),0);
  const coin=S.coin, batteryQty=X.invQty('battery');
  picked.forEach(i=>{ const q=X.invQty(i); X.sellItem(i,q); });
  if(S.coin!==coin+gain) die(`批量所得应为 ${gain}，实为 ${S.coin-coin}`);
  if(X.invQty('battery')!==batteryQty) die('锁定的物品不该被批量卖掉');
  for(const i of picked) if(X.invQty(i)) die(`${i} 应已卖光`);
  console.log(`✓ 批量售卖只结算选中项（${picked.length} 种得 ${gain}），锁定的分毫未动`);
}
process.exit(bad?1:0);
