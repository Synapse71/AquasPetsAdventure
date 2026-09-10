// 撤离整理：双栏搬运必须守恒，售卖必须过二次确认，战报数字必须自洽
import { loadProto, strip, reporter } from './_stub.mjs';
const X = loadProto('prototypes/expedition-panel.html',
  'S:()=>S,act,doSettle,IT,V,render,money,freshQty,whQty,whBaseQ,stack,'
  + 'WAREHOUSE_SLOTS,el:id=>document.getElementById(id)');
const { die, ok, end } = reporter();
const S = X.S(), IT = X.IT;
const TEST = ['gear', 'battery', 'honey', 'caviar', 'chocolate'];

// 撤离阶段的搬运都走 act(button)，这里造出等价的按钮：__whole 就是右键整格
const btn = (a, id, n, whole) => ({ dataset: { a, id, n: String(n ?? 1) }, __whole: !!whole });
const total = () => {
  const t = {};
  for (const [id, q] of S.cargo)     t[id] = (t[id] || 0) + q;
  for (const [id, q] of S.warehouse) t[id] = (t[id] || 0) + q;
  return t;
};
const setup = (cargo, wh) => {
  S.stage = 'extract';
  S.cargo = cargo.map(x => x.slice());
  S.warehouse = wh.map(x => x.slice());
  S.whBase = wh.map(x => x.slice());
  S.askSell = false; S.banked = []; S.sold = 0;
};

// 1) 任意搬运序列后，背包+仓库的物品总量守恒——一件都不能凭空生灭
setup(TEST.map((id, i) => [id, i + 2]), [['gear', 5]]);
const before = total();
let seed = 7, rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
for (let i = 0; i < 400; i++) {
  const id = TEST[rnd(TEST.length)];
  X.act(btn(rnd(2) ? 'ex-put' : 'ex-take', id, IT[id].stack || 1, rnd(2) === 0));
}
const after = total();
for (const id of new Set([...Object.keys(before), ...Object.keys(after)]))
  if ((before[id] || 0) !== (after[id] || 0))
    die(`${IT[id].name} 搬运后数量 ${after[id] || 0} ≠ 原有 ${before[id] || 0}`);
if (!S.cargo.length && !S.warehouse.length) die('400 次随机搬运后两侧全空，说明物品被吞了');
ok('400 次随机双向搬运后，背包 + 仓库的每种物品总量守恒');

// 2) 仓库里进场就有的存货取不回来，只有本次新入库的能取
setup([['honey', 3]], [['gear', 5]]);
X.act(btn('ex-take', 'gear', 5, true));
if (X.whQty('gear') !== 5) die(`进场存货被取回了，仓库剩 ${X.whQty('gear')}`);
X.act(btn('ex-put', 'honey', 3, true));
if (X.freshQty('honey') !== 3) die(`本次入库应为 3，实际 ${X.freshQty('honey')}`);
X.act(btn('ex-take', 'honey', 3, true));
if (X.whQty('honey') !== 0) die('本次入库的部分应当能全部取回');
ok('仓库里进场就有的存货取不回，只有本次新入库的可取回');

// 3) 仓库占满格子后开不了新格，但能并入未满的堆
const N = X.WAREHOUSE_SLOTS;
setup([['honey', 1], ['gear', 1]], [['gear', N * (IT.gear.stack || 1) - 1]]);
X.act(btn('ex-put', 'honey', 1));
if (X.whQty('honey') !== 0) die('仓库已满时不该为新物品开格');
X.act(btn('ex-put', 'gear', 1));
if (X.whQty('gear') !== N * (IT.gear.stack || 1)) die('仓库已满时仍应能并入未满的同类堆');
ok(`仓库占满 ${N} 格后开不了新格，但仍能并入未满的同类堆`);

// 4) doSettle：入库 = 仓库增量，售卖 = 背包剩余，背包清空
setup([['honey', 2], ['caviar', 1]], [['gear', 4]]);
X.act(btn('ex-put', 'honey', 2, true));
X.doSettle();
const banked = Object.fromEntries(S.banked);
if (banked.honey !== 2) die(`入库应为 honey×2，实际 ${JSON.stringify(S.banked)}`);
if ('gear' in banked) die('进场就在仓库里的存货不该算作本次入库');
if (S.sold !== IT.caviar.value) die(`就地售卖应得 ${IT.caviar.value}，实际 ${S.sold}`);
if (S.cargo.length) die('结算后背包应清空');
if (S.stage !== 'settle') die(`结算后应进战报页，实际 ${S.stage}`);
ok('doSettle 只把仓库增量记为入库，背包剩余全部就地售卖并清空');

// 5) 背包非空必须过二次确认，取消不结算，确认才结算；背包空则直接走
setup([['honey', 2]], []);
X.act(btn('ask-sell'));
if (!S.askSell) die('背包有东西时应弹出售卖确认');
if (S.stage === 'settle') die('确认弹窗还没点就结算了');
X.act(btn('sell-no'));
if (S.askSell || S.stage === 'settle') die('点「返回整理」不该结算');
X.act(btn('ask-sell')); X.act(btn('sell-yes'));
if (S.askSell) die('确认后弹窗应关闭');
if (S.stage !== 'settle') die('点「确认撤离」后应进战报');
setup([], [['gear', 1]]);
X.act(btn('ask-sell'));
if (S.askSell) die('背包空着时不该弹确认框');
if (S.stage !== 'settle') die('背包空着应直接结算');
ok('背包非空走二次确认（取消不结算），背包为空直接结算');

// 6) 战报三行：入库价值 + 售卖所得 = 总计收益
setup([['honey', 2], ['caviar', 1]], [['gear', 4]]);
X.act(btn('ex-put', 'honey', 2, true));
X.doSettle();
X.render();
const html = strip(X.el('mount').innerHTML);
const bv = S.banked.reduce((t, [id, q]) => t + IT[id].value * q, 0);
for (const [k, v] of [['入库战利品价值', bv], ['就地售卖所得', S.sold], ['总计收益', bv + S.sold]]) {
  // money() 是 `<img>数字`，得整段取下来再剥标签，否则截到 <img 就断了
  const m = html.match(new RegExp(`${k}</span><span class="v">([\\s\\S]*?)</span>`));
  if (!m) { die(`战报缺少「${k}」一行`); continue; }
  const got = m[1].replace(/<[^>]*>/g, '').trim();
  if (got !== String(v)) die(`「${k}」显示 "${got}" ≠ ${v}`);
}
ok(`战报三行自洽：入库 ${bv} + 售卖 ${S.sold} = 总计 ${bv + S.sold}`);

// 7) 战报明细最后一列是售卖价值，不是重量——仓库不看重量
const rows = [...html.matchAll(/<span class="nm">([\s\S]*?)<\/span>\s*<span class="num">([\s\S]*?)<\/span>/g)];
if (!rows.length) die('战报没有渲染出物品明细行');
for (const [, nm, num] of rows) {
  const plain = nm.replace(/<[^>]*>/g, '').trim();
  const it = Object.values(IT).find(t => plain.startsWith(t.name));
  if (!it) continue;
  const q = Number((plain.match(/×(\d+)/) || [, 1])[1]);
  const got = num.replace(/<[^>]*>/g, '').trim();
  if (got !== String(it.value * q))
    die(`${nm} 一列显示 "${got}"，应为售卖价值 ${it.value * q}（重量是 ${(it.weight * q).toFixed(1)}）`);
}
ok(`战报明细 ${rows.length} 行的最后一列都是售卖价值，不是重量`);
end();
