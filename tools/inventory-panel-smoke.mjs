// Real Electron integration checks in an isolated profile; never touch the player's save.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

const port = 9500 + process.pid % 400;
const profile = mkdtempSync(join(tmpdir(), 'idle-inventory-smoke-'));
const out = resolve('artifacts/inventory-panel-smoke');
mkdirSync(out, { recursive: true });
const child = spawn(electron, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'desktop/main.cjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let target;
  for (let i = 0; i < 80; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url.includes('index.html')); } catch {}
    if (target) break;
    if (child.exitCode !== null) throw new Error(`Electron exited ${child.exitCode}: ${logs}`);
    await sleep(150);
  }
  if (!target) throw new Error('No Electron renderer: ' + logs);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const callback = pending.get(message.id); pending.delete(message.id); callback?.(message); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timeout = setTimeout(() => reject(new Error(`Timed out: ${method}`)), 8000);
    pending.set(key, message => { clearTimeout(timeout); if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result); });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const assert = (value, message) => { if (!value) throw new Error(message); console.log('✓ ' + message); };
  const waitFor = async expression => {
    for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error('Condition not met: ' + expression);
  };
  const click = async selector => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center', inline:'center'})`);
    await sleep(100);
    // Target the renderer element directly: native mouse passthrough/focus can race CDP clicks.
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await sleep(450);
  };
  const shot = async name => {
    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, name + '.png'), Buffer.from(capture.data, 'base64'));
  };
  // React 用 mouseover/mouseout 合成 enter/leave，直接派发 mouseenter 不会触发。
  const hover = async selector => {
    await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}); el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); el.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));})()`);
    await sleep(200);
  };
  const tipText = () => evaluate(`document.querySelector('.item-tip')?.textContent ?? ''`);


  await send('Runtime.enable'); await send('Page.enable');
  const loaded = () => waitFor(`!!document.querySelector('.pet-hit canvas[data-pose]')`);
  const openInventory = async () => { await click('.pet-hit'); await click('.pet-bubbles button[aria-label="库存"]'); await waitFor(`!!document.querySelector('.pet-panel-host:not([hidden]) .inventory-panel')`); };
  const stored = () => evaluate(`JSON.parse(localStorage.getItem('idle-pet-adventure.demo.v1'))`);
  const reload = async () => { await send('Page.reload'); await loaded(); await openInventory(); };
  const seed = async game => { await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1', ${JSON.stringify(JSON.stringify(game))})`); await reload(); };
  const cell = id => '.ip-cell[data-item-id="' + id + '"]';
  const menuAction = async text => {
    if (!await evaluate(`Array.from(document.querySelectorAll('.ip-menu button')).some(b => b.textContent === ${JSON.stringify(text)})`)) {
      await shot('failure-menu');
      console.log(await evaluate(`({menu:document.querySelector('.ip-menu')?.textContent, bulk:document.querySelector('.ip-bulk-toggle')?.getAttribute('aria-pressed'), modal:document.querySelector('.ip-dialog')?.textContent})`));
    }
    await evaluate(`Array.from(document.querySelectorAll('.ip-menu button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`);
    await sleep(150);
  };
  const dimensions = () => evaluate(`(()=>{const r=document.querySelector('.window-inventory').getBoundingClientRect();return {width:r.width,height:r.height}})()`);
  await loaded();
  const initial = await stored(), petId = Object.keys(initial.pets)[0];
  const fixture = structuredClone(initial);
  fixture.currency = 1000;
  fixture.inventory = {'cloth-strip':46, paper:3, 'bubugao-dianduji':2, 'card-stoat':1};
  fixture.itemAcquisitionCounts = {...fixture.inventory};
  fixture.discoveredItemIds = Object.keys(fixture.inventory);
  fixture.lockedItemIds = ['paper'];
  fixture.pets[petId].secondaryStats.lore = 19;
  fixture.pets.full = {...structuredClone(fixture.pets[petId]), id:'full', name:'满属性伙伴'};
  fixture.pets.full.secondaryStats.lore = 20;
  await seed(fixture);
  assert(await evaluate(`!document.querySelector('.ip-cell[data-item-id="card-stoat"] .ip-qty')`), 'non-stackable warehouse item hides its quantity badge');
  assert(await evaluate(`!!document.querySelector('.ip-cell[data-item-id="cloth-strip"] .ip-qty')`), 'stackable warehouse item retains its quantity badge');
  const baseline = await dimensions();
  assert(baseline.width === 812 && baseline.height === 750, 'inventory retains the shared 812x750 frame');
  assert(await evaluate(`getComputedStyle(document.querySelector('.window-inventory')).boxShadow === 'none' && getComputedStyle(document.querySelector('.window-inventory')).borderTopColor === 'rgb(174, 178, 186)'`), 'inventory shares gray borders with no shadow');
  assert(await evaluate(`document.querySelectorAll('.ip-cell[data-item-id="cloth-strip"]').length === 3 && document.querySelectorAll('.ip-cell.empty').length === 33`), 'warehouse renders actual stacks and remaining empty slots');
  assert(await evaluate(`document.querySelector('.ip-footer').textContent.includes('7 / 40')`), 'warehouse capacity shows real state');
  await shot('01-inventory');
  // 悬浮提示：格子内容不动，重量 / 售价 / 标签 / 效果 / 描述都在 tooltip 里。
  await hover(cell('cloth-strip'));
  const commonTip = await tipText();
  assert(commonTip.includes('布条') && commonTip.includes('重量') && commonTip.includes('2（单重 0.1）') && commonTip.includes('售价') && commonTip.includes('材料'), 'hover tooltip carries weight, price and item tags');
  await hover(cell('card-stoat'));
  const legendaryTip = await tipText();
  assert(legendaryTip.includes('传说') && legendaryTip.includes('白鼬'), 'legendary item tooltip carries rarity and description');
  await hover(cell('bubugao-dianduji'));
  const growthTip = await tipText();
  assert(growthTip.includes('学识 +2') && growthTip.includes('永久生效'), 'growth item tooltip carries its permanent effect');
  await shot('01b-item-tooltip');
  const closePosition = () => evaluate(`(()=>{const r=document.querySelector('.ip-close').getBoundingClientRect(),h=document.querySelector('.window-inventory').getBoundingClientRect();return {x:r.x-h.x,y:r.y-h.y}})()`);
  const topClose = await closePosition(), beforeTabs = await stored();
  assert(topClose.y < 30, 'close button is in the overall top header');
  await click('.ip-tabs button:nth-child(2)');
  assert(await evaluate(`document.querySelector('.ip-idle').textContent.includes('当前没有队伍') && !document.querySelector('.ip-toolbar') && !document.querySelector('.ip-body')`), 'empty backpack tab is separate from warehouse controls');
  assert(JSON.stringify(await closePosition()) === JSON.stringify(topClose), 'close button stays in the same top position on both tabs');
  await reload();
  assert(await evaluate(`document.querySelector('.ip-tabs button:nth-child(2)').getAttribute('aria-pressed')==='true'`), 'backpack tab survives reload');
  await click('.ip-tabs button:first-child');
  const afterTabs = await stored();
  assert(JSON.stringify(afterTabs.inventory) === JSON.stringify(beforeTabs.inventory) && afterTabs.currency === beforeTabs.currency && JSON.stringify(afterTabs.expeditions) === JSON.stringify(beforeTabs.expeditions), 'switching tabs never changes items, money, or expeditions');
  await click(cell('cloth-strip'));
  assert(await evaluate(`document.querySelector('.ip-menu') && document.querySelector('.ip-detail').textContent.includes('布条')`), 'left click selects details and opens the action menu');
  await menuAction('锁定');
  assert((await stored()).lockedItemIds.includes('cloth-strip'), 'locking writes through the engine');
  await click('.ip-bulk-toggle'); await click('.ip-select-all');
  assert(await evaluate(`document.querySelector('.ip-cell[data-item-id="paper"]').disabled && document.querySelector('.ip-cell[data-item-id="cloth-strip"]').disabled`), 'bulk mode excludes locked stacks');
  await click('.ip-bulk-sell');
  assert(await evaluate(`!document.querySelector('.ip-sale-lines').textContent.includes('布条') && document.querySelector('.ip-warning').textContent.includes('史诗')`), 'batch confirmation excludes locks and warns about high rarity');
  assert((await stored()).currency === 1000, 'opening batch confirmation never sells items');
  await click('.ip-dialog-actions button:not(.ip-confirm)'); await click('.ip-bulk-toggle');
  await click(cell('cloth-strip')); await menuAction('解锁');
  await click(cell('cloth-strip')); await menuAction('售卖');
  await click('button[aria-label="增加售卖数量"]');
  assert((await stored()).inventory['cloth-strip'] === 46, 'quantity selection is a draft only');
  await click('.ip-dialog-actions button:not(.ip-confirm)');
  assert((await stored()).currency === 1000, 'cancel sale preserves inventory and currency');
  await click(cell('cloth-strip')); await menuAction('售卖'); await click('button[aria-label="增加售卖数量"]');
  await click('.pet-hit'); await openInventory();
  assert(await evaluate(`document.querySelector('input[aria-label="售卖数量"]').value === '2'`), 'close/reopen preserves sale quantity');
  await reload();
  assert(await evaluate(`document.querySelector('input[aria-label="售卖数量"]').value === '2'`), 'reload restores pending confirmation without selling');
  await shot('02-sale-confirmation');
  await click('.ip-confirm');
  let saved = await stored();
  assert(saved.inventory['cloth-strip'] === 44 && saved.currency === 1010, 'confirmed quantity sale commits once');
  assert(saved.itemAcquisitionCounts['cloth-strip'] === 46, 'sale never reduces acquisition history');
  await reload();
  assert(await evaluate(`!document.querySelector('.ip-mask')`), 'completed sale cannot replay on reload');
  await click(cell('bubugao-dianduji')); await menuAction('使用');
  assert(await evaluate(`document.querySelector('.ip-pet-choice[data-pet-id="full"]').disabled && document.querySelector('.ip-pet-list').textContent.includes('19 → 20') && document.querySelector('.ip-pet-list').textContent.includes('浪费')`), 'growth preview shows cap truncation and disables capped pets');
  await click('.ip-pet-choice[data-pet-id="' + petId + '"]');
  assert((await stored()).inventory['bubugao-dianduji'] === 2, 'selecting a pet does not consume the item');
  await shot('03-growth-confirmation');
  await click('.ip-confirm');
  saved = await stored();
  assert(saved.inventory['bubugao-dianduji'] === 1 && saved.pets[petId].secondaryStats.lore === 20, 'growth item consumes exactly one and applies the capped engine effect');
  await click('.ip-bulk-toggle'); await click('.ip-select-all'); await click('.ip-bulk-sell');
  const beforeBatch = await stored();
  await shot('04-batch-confirmation'); await click('.ip-confirm');
  saved = await stored();
  assert(JSON.stringify(saved.inventory) === JSON.stringify({paper:3}), 'confirmed batch sells only eligible types and preserves locked items');
  assert(saved.currency === beforeBatch.currency + 44 * 5 + 2000 + 3350, 'batch credits exactly the shown total');
  assert(saved.itemAcquisitionCounts['card-stoat'] === 1, 'batch sale preserves codex counts');
  await click('.ip-bulk-toggle');
  // Restore a pending sale against a changed save: it must be invalidated, not clamped and sold.
  const stale = {...saved, inventory:{'cloth-strip':4}, lockedItemIds:[]};
  await seed(stale); await click(cell('cloth-strip')); await menuAction('售卖');
  const changed = await stored(); changed.inventory['cloth-strip'] = 1;
  await seed(changed);
  assert(await evaluate(`!document.querySelector('.ip-mask') && document.querySelector('.ip-feedback').textContent.includes('已变化')`), 'stale restored quote is discarded after inventory changes');
  // Real expedition data, in an isolated profile. Arrivals are held for an hour.
  const exploring = await stored();
  exploring.expeditions = [{
    id:'inventory-test-expedition',mapId:'map-1',petIds:[petId],phase:'traveling',
    currentNodeId:'m1-start',targetNodeId:'m1-start',startedAt:Date.now(),arriveAt:Date.now()+3600000,
    cargo:{'hemp-rope':25,'card-stoat':11},initialCargo:{'hemp-rope':25},arrivalLoot:{},
    soldDuringExtraction:{},soldInitialCargo:{},visitedNodeIds:['m1-start'],drawnEventIds:[],currentSeed:1,completedNodeCount:0
  }];
  await seed(exploring);
  await click('.ip-tabs button:nth-child(2)');
  assert(await evaluate(`Array.from(document.querySelectorAll('.ip-drop')).every(b => b.disabled)`), 'traveling cargo cannot be discarded');
  assert(await evaluate(`document.querySelectorAll('.ip-slot[data-item-id="card-stoat"]').length===11&&!document.querySelector('.ip-slot[data-item-id="card-stoat"] .ip-qty')`), 'multiple non-stackable cargo items remain separate cells without badges');
  assert(await evaluate(`!!document.querySelector('.ip-slot[data-item-id="hemp-rope"] .ip-qty')`), 'stackable cargo retains its quantity badge');
  await hover('.ip-slot[data-item-id="hemp-rope"]');
  const cargoTip = await tipText();
  assert(cargoTip.includes('麻绳') && cargoTip.includes('3.6（单重 0.3）') && cargoTip.includes('本格 72'), 'cargo slot tooltip reports this slot weight and value');
  assert(await evaluate(`document.querySelector('[data-testid="cargo-weight"]').classList.contains('over') && document.querySelector('[data-testid="cargo-slots"]').classList.contains('over')`), 'weight and slot overflow are distinct indicators');
  const arrived = await stored(); arrived.expeditions[0].phase = 'awaiting-route';
  await seed(arrived);
  await shot('05-cargo-overload');
  assert(await evaluate(`getComputedStyle(document.querySelector('.ip-cargo-list')).position==='static' && document.querySelector('.ip-cargo-page').scrollWidth <= document.querySelector('.ip-cargo-page').clientWidth`), 'cargo details use in-panel scrolling without overlay or horizontal overflow');
  assert(await evaluate(`Array.from(document.querySelectorAll('.ip-drop')).every(b => !b.disabled)`), 'arrived cargo can be organized');
  await click('.ip-drop');
  await evaluate(`const n=document.querySelector('input[aria-label="丢弃数量"]'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(n,'2'); n.dispatchEvent(new Event('input',{bubbles:true}));`);
  await click('.ip-confirm');
  saved = await stored();
  assert(saved.expeditions[0].cargo['hemp-rope'] === 23 && saved.expeditions[0].initialCargo['hemp-rope'] === 23, 'cargo discard preserves the engine initial-cargo accounting');
  assert(saved.currency === arrived.currency, 'cargo discard does not grant sale money');
  // 背包明细按格排列：麻绳 23 件是 12 / 11 两格，点第二格丢光只动第二格。
  assert(await evaluate(`document.querySelectorAll('.ip-cargo-row').length === 13 && document.querySelectorAll('.ip-cargo-row')[1].textContent.includes('第 2/2 格')`), 'cargo details list one row per slot');
  await evaluate(`document.querySelectorAll('.ip-drop')[1].click()`);
  await sleep(150);
  assert(await evaluate(`document.querySelector('input[aria-label="丢弃数量"]').max === '11'`), 'cargo discard caps at the clicked slot, not the item total');
  await evaluate(`(()=>{const n=document.querySelector('input[aria-label="丢弃数量"]'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(n,'11'); n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('.ip-confirm');
  saved = await stored();
  assert(saved.expeditions[0].cargo['hemp-rope'] === 12 && saved.expeditions[0].cargo['card-stoat'] === 11, 'discarding one slot leaves the same item\'s other slot untouched');
  assert(JSON.stringify(await dimensions()) === JSON.stringify(baseline), 'cargo tab and confirmations never resize the frame');
  await click('.ip-reports');
  assert(await evaluate(`document.querySelector('.ip-dialog').textContent.includes('还没有冒险战报')`), 'reports remain accessible without a third inventory container');
  await click('.ip-dialog-actions button'); await click('.ip-close');
  // 售卖以格为单位：46 件布条是 20 / 20 / 6 三格，点哪一格就只动哪一格。
  const perCell = await stored();
  perCell.inventory = {'cloth-strip': 46, 'canned-food': 1};
  perCell.itemAcquisitionCounts = {'cloth-strip': 46};
  perCell.discoveredItemIds = ['cloth-strip'];
  perCell.lockedItemIds = [];
  perCell.expeditions = [];
  await seed(perCell);
  await click('.ip-tabs button:first-child');
  await click('.ip-bulk-toggle');
  await evaluate(`document.querySelectorAll('.ip-cell[data-item-id="cloth-strip"]')[1].click()`);
  await sleep(200);
  assert(await evaluate(`document.querySelector('.ip-footer').textContent.includes('已选 1 格 · 20 件')`), 'bulk picking one slot counts only that slot');
  await hover('.ip-cell[data-item-id="canned-food"]');
  assert((await tipText()).includes('出发前吃下：体能 +1'), 'food tooltip carries its expedition buff');
  assert(await evaluate(`document.querySelectorAll('.ip-cell[data-item-id="cloth-strip"][aria-pressed="true"]').length === 1`), 'picking one slot does not select the same item in other slots');
  await click('.ip-bulk-sell');
  assert(await evaluate(`document.querySelector('.ip-sale-lines').textContent.includes('×20')`), 'batch quote shows the selected slot quantity only');
  await click('.ip-confirm');
  saved = await stored();
  assert(saved.inventory['cloth-strip'] === 26 && saved.currency === perCell.currency + 100, 'selling one slot deducts only that slot');
  await click('.ip-bulk-toggle');
  await evaluate(`document.querySelectorAll('.ip-cell[data-item-id="cloth-strip"]')[0].click()`);
  await sleep(200);
  await menuAction('售卖');
  assert(await evaluate(`document.querySelector('input[aria-label="售卖数量"]').max === '20' && document.querySelector('.ip-hint').textContent.includes('本格')`), 'single-slot sale caps the quantity at that slot');
  await click('.ip-quantity button:last-child');
  assert(await evaluate(`document.querySelector('input[aria-label="售卖数量"]').value === '20'`), '本格全部 fills exactly one slot worth');
  await click('.ip-confirm');
  saved = await stored();
  assert(saved.inventory['cloth-strip'] === 6 && saved.currency === perCell.currency + 200, 'selling a whole slot leaves the other slots of the same item alone');
  await reload();
  const empty = await stored(); empty.expeditions=[]; empty.inventory={}; empty.lockedItemIds=[];
  await seed(empty); await click('.ip-tabs button:first-child');
  assert(await evaluate(`document.querySelectorAll('.ip-cell.empty').length === 40 && !document.querySelector('.ip-menu')`), 'empty inventory remains usable with all empty slots visible');
  await shot('07-empty');
  assert(errors.length === 0, 'inventory has no renderer exceptions');
  writeFileSync(join(out, 'result.json'), JSON.stringify({passed:true, baseline, profile, errors}, null, 2));
  console.log('Screenshots: ' + out);
} catch (error) {
  console.error(error); console.error(logs); process.exitCode = 1;
} finally { ws?.close(); child.kill(); }
