import fs from 'node:fs';
const body = fs.readFileSync('prototypes/codex-panel.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const mkEl=()=>({innerHTML:'',textContent:'',disabled:false,dataset:{},hidden:false,className:'',
  style:{setProperty(){}},querySelector:()=>mkEl(),querySelectorAll:()=>[],
  addEventListener(){},setAttribute(){},getAttribute:()=>null,appendChild:()=>{},
  getBoundingClientRect:()=>({left:0,top:0,right:60,bottom:60,width:60,height:60}),
  classList:{add(){},remove(){},toggle(){},contains:()=>false}});
const els={};
globalThis.window={innerWidth:1400,innerHeight:900};
globalThis.document={getElementById:id=>(els[id]??=mkEl()),createElement:()=>mkEl(),
  body:mkEl(),documentElement:mkEl(),querySelector:()=>mkEl(),querySelectorAll:()=>[]};
globalThis.getComputedStyle=()=>({getPropertyValue:()=>'#3f8f6a'});
new Function(body+';globalThis.__C={S:()=>S,IT,V,mock,owned,COLLECT_IDS,NORMAL_IDS,'
  +'cellHTML,showTip,RORDER,render,MAPS,nodeSeen,nodeHTML,lootLine,PETS,TAGS};')();
const C=globalThis.__C, S=C.S();
let bad=0; const die=m=>{console.error('✗',m);bad++;};
const cat=JSON.parse(fs.readFileSync('src/domain/catalog.bundled.json','utf8'));
const strip=h=>h.replace(/src="data:[^"]*"/g,'src=""');

// 1) 物品数据与 catalog 一致，且 93 件图标齐全
{
  const ids=Object.keys(C.IT);
  if(ids.length!==Object.keys(cat.items).length)
    die(`物品数 ${ids.length} ≠ catalog ${Object.keys(cat.items).length}`);
  for(const id of ids){
    const a=C.IT[id], b=cat.items[id];
    if(!b){ die(`${id} 不在 catalog 里`); continue; }
    if(a.name!==b.name||a.rarity!==b.rarity||a.weight!==b.weight)
      die(`${id} 基础字段与 catalog 不符`);
    if((a.description||"")!==(b.description||"")) die(`${id} 描述与 catalog 不符`);
  }
  console.log(`✓ ${ids.length} 件物品的名称/稀有度/重量/描述与 catalog 一致`);
}

// 2) 收藏品分组 = catalog 里带 collectible 的那批
{
  const want=Object.keys(cat.items).filter(i=>(cat.items[i].tags||[]).includes('collectible'));
  if(JSON.stringify(C.COLLECT_IDS.slice().sort())!==JSON.stringify(want.slice().sort()))
    die(`收藏品分组不符：${C.COLLECT_IDS} ≠ ${want}`);
  if(C.COLLECT_IDS.some(i=>C.NORMAL_IDS.includes(i))) die('收藏品不该同时出现在普通分组里');
  if(C.COLLECT_IDS.length+C.NORMAL_IDS.length!==Object.keys(C.IT).length)
    die('两个分组之和应等于总数');
  console.log(`✓ 收藏品 ${C.COLLECT_IDS.length} 件独立成组，与其余 ${C.NORMAL_IDS.length} 件不重不漏`);
}

// 3) 收藏品全列（含未获得），其余只列已获得
{
  C.mock('none');
  let html=strip(C.V.item());
  for(const id of C.COLLECT_IDS)
    if(!html.includes(`data-id="${id}"`)) die(`全未获得时收藏品 ${id} 仍应占位`);
  const shown=[...html.matchAll(/data-id="([^"]+)"/g)].map(m=>m[1]);
  const extra=shown.filter(i=>!C.COLLECT_IDS.includes(i));
  if(extra.length) die(`全未获得时不该列出非收藏品：${extra.slice(0,3)}`);
  console.log('✓ 全未获得时：收藏品 5 格占位，其余一件不列');

  C.mock('mid');
  html=strip(C.V.item());
  const shown2=[...html.matchAll(/data-id="([^"]+)"/g)].map(m=>m[1]);
  const notOwned=shown2.filter(i=>!C.owned(i));
  if(notOwned.some(i=>!C.COLLECT_IDS.includes(i)))
    die(`未获得的非收藏品被列出来了：${notOwned.filter(i=>!C.COLLECT_IDS.includes(i)).slice(0,3)}`);
  const ownedNormal=C.NORMAL_IDS.filter(C.owned);
  for(const id of ownedNormal)
    if(!shown2.includes(id)) die(`已获得的 ${id} 应该出现在图鉴里`);
  console.log(`✓ 中期存档：已获得的 ${ownedNormal.length} 件普通物品全部列出，未获得的一件不列`);
}

// 4) 未获得的收藏品必须打码：格子不带稀有度底色，tooltip 三处都是 ？？？
{
  C.mock('none');
  const html=strip(C.cellHTML(C.COLLECT_IDS[0]));
  if(!html.includes('locked')) die('未获得的格子应带 locked 标记');
  if(/background:#[0-9A-Fa-f]{6}/.test(html)) die('未获得的格子不该铺稀有度底色，会泄漏稀有度');
  if(html.includes('class="q"')) die('未获得的格子不该显示数量');

  const box=els['tip'] ?? (els['tip']=mkEl());
  const slots={tn:mkEl(),tr:mkEl(),td:mkEl(),tm:mkEl()};
  box.querySelector=(sel)=>slots[sel.replace('.','')];
  C.showTip(mkEl(), C.COLLECT_IDS[0]);
  if(slots.tn.textContent!=='？？？') die(`未获得时标题应为 ？？？，实为 "${slots.tn.textContent}"`);
  if(!slots.tr.hidden) die('未获得时稀有度那行应收起');
  if(!slots.td.hidden) die('未获得时描述那行应收起');
  if(slots.tr.textContent==='？？？'||slots.td.textContent==='？？？')
    die('稀有度/描述不该再填问号，应整行收起');
  const real=C.IT[C.COLLECT_IDS[0]];
  if([slots.tn,slots.tr,slots.td,slots.tm].some(s=>
      String(s.textContent||'').includes(real.name) || String(s.innerHTML||'').includes(real.name)))
    die('未获得时 tooltip 泄漏了真实名称');
  console.log('✓ 未获得的收藏品：无稀有度底色、无数量角标，只有标题显示 ？？？，另两行收起');
}

// 5) 已获得的收藏品正常显示，且累计件数取自 counts
{
  C.mock('none');
  S.counts[C.COLLECT_IDS[0]]=7;
  const html=strip(C.cellHTML(C.COLLECT_IDS[0]));
  if(html.includes('locked')) die('已获得的不该还是 locked');
  if(!html.includes('>7<')) die('应显示累计件数 7');
  const slots={tn:mkEl(),tr:mkEl(),td:mkEl(),tm:mkEl()};
  const box=els['tip']; box.querySelector=(sel)=>slots[sel.replace('.','')];
  C.showTip(mkEl(), C.COLLECT_IDS[0]);
  if(slots.tn.textContent!==C.IT[C.COLLECT_IDS[0]].name) die('已获得时应显示真实名称');
  if(slots.tr.hidden) die('已获得时稀有度那行应重新显示');
  if(!String(slots.tm.innerHTML).includes('7')) die('tooltip 应显示累计获得 7 件');
  console.log('✓ 已获得的收藏品显示真实信息，累计件数取自 itemAcquisitionCounts');
}

// 6) 分组顺序：收藏品在最前，其余从高稀有度到低
{
  C.mock('all');
  const html=strip(C.V.item());
  const order=[...html.matchAll(/class="grp-t"[^>]*>([^<]+)</g)].map(m=>m[1]);
  if(order[0]!=='收藏品') die(`第一组应是收藏品，实为 ${order[0]}`);
  const want=['收藏品','神话','传说','史诗','稀有','罕见','常见'];
  if(JSON.stringify(order)!==JSON.stringify(want))
    die(`分组顺序应为 ${want.join(' → ')}，实为 ${order.join(' → ')}`);
  if(html.includes('/ ')&&/\d+\s*\/\s*\d+/.test(html.split('grid')[0]))
    die('分组标题不该显示 已得/总数');
  console.log(`✓ 分组顺序：${want.join(' → ')}，标题不带计数`);
}

// 7) 地点 / 宠物分类留了入口但不可点
{
  const page=fs.readFileSync('prototypes/codex-panel.html','utf8');
  if(!/data-tab="place"[^>]*hidden/.test(page)) die('地点入口应处于隐藏状态');
  if(/data-tab="pet"[^>]*(disabled|hidden)/.test(page)) die('宠物入口应可点');
  if(C.V.place().includes('soon')) die('地点代码应保留实现，不是占位');
  console.log('✓ 地点入口已隐藏但代码保留；宠物入口开放');
}

// 8) 稀有度中文名要和其它面板 / catalog 注释一致
{
  const want={common:"常见",uncommon:"罕见",rare:"稀有",epic:"史诗",legendary:"传说",mythic:"神话"};
  C.mock('all');
  const html=strip(C.V.item());
  for(const [k,label] of Object.entries(want)){
    if(!html.includes(`>${label}<`)) die(`分组标题缺少「${label}」`);
  }
  for(const wrong of ["普通","优良"])
    if(html.includes(`>${wrong}<`)) die(`不该出现旧稀有度名「${wrong}」`);
  const other=fs.readFileSync('prototypes/expedition-panel.html','utf8')
    .match(/const RNAME = \{[^}]*\}/)[0];
  for(const [k,label] of Object.entries(want))
    if(!other.includes(`${k}:"${label}"`)) die(`探险面板的 ${k} 不是「${label}」`);
  console.log('✓ 稀有度中文名：常见/罕见/稀有/史诗/传说/神话，与其它面板一致');
}

// 9) 界面上不许出现原型自己编的物品说明
{
  const page=fs.readFileSync('prototypes/codex-panel.html','utf8');
  for(const invented of ["收藏用，不参与合成与消耗","不参与合成"])
    if(page.includes(invented)) die(`界面里残留自造文案：「${invented}」`);
  // 分组头只允许有标题，不许挂说明
  C.mock('all');
  const html=strip(C.V.item());
  if(html.includes('grp-note')) die('分组标题不该再挂说明文字');
  console.log('✓ 分组标题只有名字，没有自造的说明文案');
}

// 10) 地图与地点数据必须和 catalog 对得上
{
  const catMaps=cat.maps;
  if(Object.keys(C.MAPS).length!==Object.keys(catMaps).length) die('地图数与 catalog 不符');
  for(const [mid,m] of Object.entries(C.MAPS)){
    const cm=catMaps[mid];
    if(!cm){ die(`地图 ${mid} 不在 catalog 里`); continue; }
    if(m.name!==cm.name||m.start!==cm.startNodeId) die(`${mid} 名称或起点不符`);
    if(Object.keys(m.nodes).length!==Object.keys(cm.nodes).length) die(`${mid} 节点数不符`);
    for(const [nid,n] of Object.entries(m.nodes)){
      const cn=cm.nodes[nid];
      if(n.name!==cn.name) die(`${nid} 名称不符`);
      if(!!n.terminal!==!!cn.terminal) die(`${nid} terminal 不符`);
      if(!!n.extractable!==!!cn.extractable) die(`${nid} extractable 不符`);
      if(n.edges.length!==(cn.edges||[]).length) die(`${nid} 出口数不符`);
    }
  }
  const total=Object.values(C.MAPS).reduce((t,m)=>t+Object.keys(m.nodes).length,0);
  console.log(`✓ ${Object.keys(C.MAPS).length} 张地图 / ${total} 处地点与 catalog 一致`);
}

// 11) 掉落期望件数要等于 catalog 里两种模式各自算出来的结果
{
  const R=["common","uncommon","rare","epic","legendary","mythic"];
  for(const [mid,cm] of Object.entries(cat.maps))
    for(const [nid,cn] of Object.entries(cm.nodes)){
      const l=C.MAPS[mid].nodes[nid].loot;
      if(!cn.loot){ if(l) die(`${nid} 没配掉落却有 loot`); continue; }
      let want={};
      if(cn.loot.mode==='independent'){
        const w=cn.loot.rarityWeights, tot=Object.values(w).reduce((a,b)=>a+b,0);
        const avg=(cn.loot.minCount+cn.loot.maxCount)/2;
        R.forEach(r=>want[r]=Math.round(w[r]/tot*avg*100)/100);
      } else {
        const comps=cn.loot.compositions, tot=comps.reduce((a,x)=>a+x.weight,0);
        R.forEach(r=>want[r]=0);
        comps.forEach(x=>R.forEach(r=>want[r]+=x.weight/tot*(x.rarityCounts[r]||0)));
        R.forEach(r=>want[r]=Math.round(want[r]*100)/100);
      }
      for(const r of R)
        if(Math.abs(l.exp[r]-want[r])>0.011) die(`${nid} ${r} 期望 ${l.exp[r]} ≠ ${want[r]}`);
    }
  console.log('✓ 每处地点的掉落期望件数与 catalog 的两种抽取模式逐档吻合');
}

// 12) 没去过的地点只显示 ？？？，不泄漏名字和掉落
{
  C.mock('none');
  const html=strip(C.V.place());
  if(html.includes('nd-n')) die('两张图都没解锁时不该渲染出任何地点条目');
  for(const m of Object.values(C.MAPS))
    for(const n of Object.values(m.nodes))
      if(html.includes(n.name)) die(`未解锁时泄漏了地点名「${n.name}」`);
  C.mock('early');
  const h2=strip(C.V.place());
  const titles=[...h2.matchAll(/class="nd-n">([^<]*)</g)].map(m=>m[1]);
  const m1=C.MAPS['map-1'];
  for(const [nid,n] of Object.entries(m1.nodes)){
    if(C.nodeSeen(nid)){ if(!titles.includes(n.name)) die(`去过的 ${n.name} 应作为标题显示`); }
    else if(titles.includes(n.name)) die(`没去过的 ${n.name} 不该作为标题显示`);
  }
  if(!titles.includes('？？？')) die('没去过的地点标题应为 ？？？');
  console.log('✓ 没去过的地点只显示 ？？？，未解锁地图不泄漏任何地点名');
}

// 13) 条件路线要标出门槛，撤离过的要打标记
{
  C.mock('all');
  const html=strip(C.V.place());
  // catalog 里 m1-start→m1-point-2 与 m2-start→m2-point-3 都要求勇气 ≥2
  const reqEdges=[];
  for(const cm of Object.values(cat.maps))
    for(const cn of Object.values(cm.nodes))
      for(const e of (cn.edges||[])) if(e.requirement) reqEdges.push(e);
  if(!reqEdges.length) die('catalog 里应有条件路线');
  for(const e of reqEdges){
    const v=e.requirement.secondary;
    if(v && !html.includes(`≥ ${v.value}`)) die(`条件路线「${e.label}」没标出门槛`);
  }
  if(!html.includes('撤离过')) die('撤离过的地点应打标记');
  if(!html.includes('首次撤离奖励')) die('配了首撤奖励的地点应展示出来');
  console.log(`✓ ${reqEdges.length} 条条件路线标出属性门槛，撤离记录与首撤奖励正常展示`);
}

// 14) 宠物与特质数据必须来自 catalog
{
  if(JSON.stringify(C.PETS)!==JSON.stringify(cat.petTemplates)) die('宠物模板与 catalog 不一致');
  if(JSON.stringify(C.TAGS)!==JSON.stringify(cat.tags)) die('特质表与 catalog 不一致');
  console.log(`✓ ${Object.keys(C.PETS).length} 个宠物模板 / ${Object.keys(C.TAGS).length} 个特质与 catalog 一致`);
}

// 15) 没结识的伙伴显示剪影且不泄漏名字与数值
{
  C.mock('none');
  const html=strip(C.V.pet());
  for(const p of Object.values(C.PETS)){
    if(html.includes(p.name)) die(`未结识时泄漏了伙伴名「${p.name}」`);
    for(const v of Object.values(p.baseStats))
      if(new RegExp(`<b>${v}</b>`).test(html)) die('未结识时泄漏了属性数值');
  }
  if(!html.includes('petcard unk')) die('未结识的伙伴应显示为剪影卡');
  console.log('✓ 未结识的伙伴显示剪影，不泄漏名字与初始数值');
}

// 16) 特质不再单独成组；特质行常驻占位，保证有无特质的卡片等高
{
  C.mock('all');
  let html=strip(C.V.pet());
  if(html.includes('tagcard')) die('特质不该再单独列成一组');
  if(!html.includes('petgrid')) die('宠物应使用卡片网格而不是整行列表');
  const cards=(html.match(/class="petcard/g)||[]).length;
  if(cards!==Object.keys(C.PETS).length) die(`卡片数 ${cards} ≠ 模板数`);

  // 每张已结识的卡片都必须有特质行——没有初始特质的那张靠 .none 隐藏内容但保留高度
  const shown=(html.match(/class="pc-innate/g)||[]).length;
  if(shown!==S.pets.length) die(`特质行应每张已结识卡片各一条，实为 ${shown}`);
  for(const [id,p] of Object.entries(C.PETS)){
    if(!S.pets.includes(id)) continue;
    const seg=html.slice(html.indexOf(p.name));
    const m=seg.match(/class="pc-innate([^"]*)"/);
    if(!m) { die(`${p.name} 缺少特质行`); continue; }
    const hidden=m[1].includes('none');
    if(p.innateTagId && hidden) die(`${p.name} 配了初始特质却把那行隐藏了`);
    if(!p.innateTagId && !hidden) die(`${p.name} 没有初始特质，那行应隐藏但保留占位`);
    if(p.innateTagId){
      const name=C.TAGS[p.innateTagId]?.name;
      if(name && !html.includes(name)) die(`初始特质 ${name} 应显示出来`);
    }
  }
  console.log(`✓ 宠物用卡片网格呈现（${cards} 张）；特质行常驻占位，有无特质的卡片等高`);
}

process.exit(bad?1:0);
