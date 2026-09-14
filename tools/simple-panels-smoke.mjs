// Real Electron integration checks in an isolated profile; never touch the player's save.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

const port = 9500 + process.pid % 400;
const settingsOnly = process.argv.includes('--settings-only');
const appIndex = process.argv.indexOf('--app');
if (appIndex >= 0 && !process.argv[appIndex + 1]) throw new Error('--app requires an executable path');
const packagedApp = appIndex >= 0 ? resolve(process.argv[appIndex + 1]) : null;
const profile = mkdtempSync(join(tmpdir(), 'idle-simple-panels-smoke-'));
const out = resolve('artifacts/simple-panels-smoke');
mkdirSync(out, { recursive: true });
const child = spawn(packagedApp ?? electron, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, ...(packagedApp ? [] : ['desktop/main.cjs'])], { stdio: ['ignore', 'pipe', 'pipe'] });
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
    // Keep native hover from replacing the tooltip selected by the synthetic click.
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
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



  await send('Runtime.enable'); await send('Page.enable');
  const loaded=()=>waitFor(`!!document.querySelector('.pet-hit canvas[data-pose]')`);
  const open=async label=>{await click('.pet-hit');await click('.pet-bubbles button[aria-label="'+label+'"]');};
  const stored=()=>evaluate(`JSON.parse(localStorage.getItem('idle-pet-adventure.demo.v1'))`);
  const textButton=async text=>{await evaluate(`Array.from(document.querySelectorAll('.pet-panel-host button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`);await sleep(150);};
  const input=async (selector,value)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(200);};
  await loaded();
  const initial=await stored(),fixture=structuredClone(initial),petId=Object.keys(initial.pets)[0];
  fixture.inventory={};fixture.itemAcquisitionCounts={'cloth-strip':12,'card-stoat':3};fixture.discoveredItemIds=['cloth-strip','card-stoat'];
  fixture.currency=4321;fixture.pets[petId].baseStats.fitness=40;
  fixture.log=[{id:'settings-log-1',createdAt:Date.now(),message:'测试记录：队伍已抵达节点。'},{id:'settings-log-2',createdAt:Date.now()-60000,message:'测试记录：伙伴开始探险。'}];
  await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1',${JSON.stringify(JSON.stringify(fixture))})`);
  await send('Page.reload');await loaded();
  if (!settingsOnly) {
  await open('图鉴');
  assert(await evaluate(`document.querySelector('.window-codex').getBoundingClientRect().width===812&&document.querySelector('.window-codex').getBoundingClientRect().height===750`),'codex keeps the shared 812x750 frame');
  assert(await evaluate(`document.querySelector('.cd-group').dataset.group==='collectible' && !document.querySelector('.cd-cell[data-item-id="paper"]')`),'collectibles stay first and unknown ordinary items are absent');
  assert(await evaluate(`!document.querySelector('.cd-cell .cd-count') && !document.querySelector('.cd-cell[data-item-id="cloth-strip"]').textContent.match(/\\d/)`),'codex item icons do not display lifetime count badges');
  await shot('01-codex');
  const unknown=await evaluate(`document.querySelector('.cd-cell.unknown').dataset.itemId`);
  await click('.cd-cell[data-item-id="'+unknown+'"]');
  assert(await evaluate(`document.querySelector('.cd-tip').textContent==='？？？' && !document.querySelector('.cd-cell.unknown .cd-count') && !document.querySelector('.cd-cell.unknown').getAttribute('style')`),'unknown collectible exposes no name, rarity, count, or tags');
  await shot('02-unknown');
  await click('.cd-cell[data-item-id="card-stoat"]');
  assert(await evaluate(`document.querySelector('.cd-tip').textContent.includes('累计获得 3 件')&&document.querySelector('.cd-tip').textContent.includes('收藏品')`),'known item tooltip includes tags and lifetime count');
  await shot('03-known');
  assert(await evaluate(`!document.querySelector('.codex-panel').textContent.match(/已登记|完成率|收藏品进度|收集进度/)`),'codex contains no collection progress');
  await textButton('宠物');
  assert(await evaluate(`document.querySelector('.cd-pet-stats').textContent.includes('体能 2')&&!document.querySelector('.cd-pet-stats').textContent.includes('40')`),'pet codex uses template stats, not current growth');
  await shot('04-pets');
  await click('.sp-close');
  }
  await open('设置');
  const dimensions=()=>evaluate(`(()=>{const r=document.querySelector('.window-settings').getBoundingClientRect();return [r.width,r.height]})()`);
  assert(JSON.stringify(await dimensions())==='[812,750]','settings uses the shared 812x750 frame');
  await shot('05-settings');
  assert(await evaluate(`!document.querySelector('.st-about')&&!document.querySelector('.st-dev')&&document.querySelectorAll('.settings-panel .sp-tabs button').length===3`), 'about is a peer tab and absent from general settings');
  await textButton('关于');
  await waitFor(`document.querySelector('.st-game-logo')?.naturalWidth > 0`);
  assert(await evaluate(`document.querySelector('.st-about').textContent.includes('版本信息')&&document.querySelector('.st-game-name').textContent==='咕嘎搜撤没有打 v0.1.0 Demo'&&document.querySelector('.st-about').textContent.includes('Aquamarine Studio')&&!document.querySelector('.st-dev')&&!document.querySelector('.st-row')&&!document.querySelector('.st-about').textContent.match(/Windows|macOS|策划配置台/)`), 'about shows the requested game name, version, logo and studio without old content');
  assert(await evaluate(`document.querySelector('.st-game-logo').getAttribute('src').endsWith('icons/aquamarine-1024.png')`), 'about reuses the same logo source as the native menu bar');
  await shot('09-about');
  await send('Page.reload');await loaded();await open('设置');
  assert(await evaluate(`document.querySelector('.settings-panel .sp-tabs button:nth-child(3)').getAttribute('aria-pressed')==='true'&&!!document.querySelector('.st-about')`), 'about tab selection survives reload');
  await textButton('设置');
  // Use trusted Chromium mouse input: synthetic pointer events do not exercise
  // the native range control's pointer-capture lifecycle.
  const realSlider = await evaluate(`(()=>{const r=document.querySelector('input[aria-label="桌宠大小"]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  const realBefore = await evaluate(`window.desktopPet.getState()`);
  const mouseY = realSlider.y + realSlider.height / 2;
  const realSliderRect = () => evaluate(`(()=>{const r=document.querySelector('input[aria-label="桌宠大小"]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  const thumbX=realSlider.x+8+(realSlider.width-16)*(realBefore.canvas-130)/290;
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:thumbX,y:mouseY});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:thumbX,y:mouseY,button:'left',buttons:1,clickCount:1});
  let previousCanvas=realBefore.canvas;
  for (const fraction of [.9,.2,.7,.05]) {
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:realSlider.x+realSlider.width*fraction,y:mouseY,button:'left',buttons:1});
    await sleep(150);
    const current = await evaluate(`window.desktopPet.getState()`);
    assert(current.canvas!==previousCanvas,'real mouse movement changes pet size to '+current.canvas+'px');
    previousCanvas=current.canvas;
    assert(JSON.stringify(current.layout.bounds)===JSON.stringify(realBefore.layout.bounds)&&JSON.stringify(current.layout.panel)===JSON.stringify(realBefore.layout.panel)&&JSON.stringify(await realSliderRect())===JSON.stringify(realSlider),'real held mouse drag keeps native bounds, panel and slider fixed');
  }
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:realSlider.x+realSlider.width*.05,y:mouseY,button:'left',buttons:0,clickCount:1});
  await sleep(200);
  assert(JSON.stringify((await evaluate(`window.desktopPet.getState()`)).layout)!==JSON.stringify(realBefore.layout),'real mouse release applies the resized layout');
  await input('input[aria-label="桌宠大小"]','300');
  const resizeSnapshot = () => evaluate(`(async()=>{const state=await window.desktopPet.getState();const r=document.querySelector('input[aria-label="桌宠大小"]').getBoundingClientRect();return {bounds:state.layout.bounds,panel:state.layout.panel,slider:[r.x,r.y,r.width,r.height]};})()`);
  const frozen = await resizeSnapshot();
  await evaluate(`document.querySelector('input[aria-label="桌宠大小"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}))`);
  for (const size of ['420','180','300','130']) {
    await input('input[aria-label="桌宠大小"]',size);
    assert(JSON.stringify(await resizeSnapshot())===JSON.stringify(frozen),'held resize keeps window, panel and slider fixed at '+size+'px');
  }
  await evaluate(`window.dispatchEvent(new PointerEvent('pointerup',{button:0,pointerId:1}))`);
  await sleep(200);
  const released = await resizeSnapshot();
  assert(JSON.stringify(released)!==JSON.stringify(frozen),'pointer release resumes normal positioning');
  await evaluate(`document.querySelector('input[aria-label="桌宠大小"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:2}))`);
  await input('input[aria-label="桌宠大小"]','420');
  await evaluate(`window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:2}))`);
  await sleep(200);
  assert(JSON.stringify(await resizeSnapshot())!==JSON.stringify(released),'pointer cancellation also releases the layout lock');
  await input('input[aria-label="桌宠大小"]','130');
  await waitFor(`document.querySelector('.st-row output').textContent==='130px'`);
  assert(await evaluate(`document.querySelector('.pet-hit').getBoundingClientRect().width===130`),'minimum pet is half the previous 260px minimum');
  assert(await evaluate(`document.querySelector('.st-menu-preview>span').getBoundingClientRect().width===16`),'minimum bubble preview is halved to 16px');
  assert(await evaluate(`getComputedStyle(document.querySelector('.pet-bubbles button')).width==='16px'`),'actual bubble matches the settings preview');
  assert(JSON.parse(readFileSync(join(profile,'desktop-preferences.json'),'utf8')).canvas===130,'minimum size is persisted to the native preferences file');
  await send('Page.reload'); await loaded(); await open('设置');
  assert(await evaluate(`document.querySelector('.st-row output').textContent==='130px'`),'minimum size survives renderer reload');
  await shot('11-minimum-settings');
  await click('.sp-close'); await click('.pet-hit');
  assert(await evaluate(`(()=>{const buttons=[...document.querySelectorAll('.pet-bubbles.open button')];return buttons.length===5&&buttons.every(b=>{const r=b.getBoundingClientRect();return r.width===16&&r.height===16&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;});})()`),'all five minimum-size bubbles are fully visible in the native window');
  assert(await evaluate(`Array.from(document.querySelectorAll('.pet-bubbles button')).every(b=>b.title===b.getAttribute('aria-label')&&b.title.length>0)`),'all menu buttons expose their function name as a hover tooltip');
  await shot('12-minimum-menu');
  await click('.pet-bubbles button[aria-label="设置"]');
  await input('input[aria-label="桌宠大小"]','300');
  await click('input[aria-label="始终置顶"]');
  assert((await evaluate(`window.desktopPet.getState()`)).alwaysOnTop===false,'always-on-top setting reaches the native window');
  await send('Page.reload');await loaded();await open('设置');
  assert(await evaluate(`!document.querySelector('input[aria-label="始终置顶"]').checked`),'native settings survive renderer reload');
  await click('input[aria-label="始终置顶"]');
  const downloads=join(profile,'downloads');mkdirSync(downloads,{recursive:true});
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  const beforeExport=await stored();
  await textButton('导出存档');
  let file;
  for(let i=0;i<100;i++){file=readdirSync(downloads).find(name=>name.endsWith('.json'));if(file)break;await sleep(100);}
  assert(!!file,'export produces a real JSON download');
  const backup=JSON.parse(readFileSync(join(downloads,file),'utf8'));
  assert(backup.format==='idle-pet-save'&&JSON.stringify(backup.game)===JSON.stringify(beforeExport),'export is a lossless game snapshot');
  await textButton('清空本地存档');
  assert(await evaluate(`document.querySelector('.st-reset-dialog').textContent.includes('无法找回')&&document.querySelector('.st-reset-actions .st-danger').disabled`),'reset warns about data loss and requires explicit confirmation text');
  await shot('06-reset-confirm');
  await input('input[aria-label="清档确认文字"]','错误文字');
  assert(await evaluate(`document.querySelector('.st-reset-actions .st-danger').disabled`),'incorrect confirmation cannot clear the save');
  await textButton('取消');
  assert((await stored()).currency===4321,'cancel reset leaves the save unchanged');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  await shot('07-dark-settings');
  assert(JSON.stringify(await dimensions())==='[812,750]','preview, confirmation, and theme never change panel size');
  await textButton('行动记录');
  assert(await evaluate(`!!document.querySelector('.settings-panel .sp-tabs button[aria-pressed="true"]')&&!!document.querySelector('.st-content > .log-list')&&!document.querySelector('.st-content .panel')&&!document.querySelector('.st-content h2')&&!document.querySelector('.st-content .eyebrow')&&!document.querySelector('.st-content').textContent.includes('LOG')`),'action log is only a list without the old card or duplicated heading');
  await shot('10-action-log');
  assert(await evaluate(`document.querySelectorAll('.st-content > .log-list li').length===2&&document.querySelector('.log-list').textContent.includes('队伍已抵达节点')`),'action list preserves recorded timestamps and messages');
  await textButton('设置');await textButton('清空本地存档');
  await input('input[aria-label="清档确认文字"]','重新开始');await textButton('确认清空');
  await waitFor(`document.querySelector('.pet-panel-host').hidden`);
  const reset=await stored();
  assert(reset.currency===initial.currency&&reset.pets[petId].baseStats.fitness===initial.pets[petId].baseStats.fitness,'confirmed reset creates a fresh game only in the isolated test profile');
  if (!settingsOnly) {
  await open('图鉴');await textButton('物品');
  assert(await evaluate(`getComputedStyle(document.querySelector('.cd-cell.unknown img')).filter.includes('invert(1)')`),'unknown silhouettes remain visible in dark mode');
  await shot('08-dark-codex');
  await click('.sp-close');
  }
  await open('设置');
  assert(await evaluate(`Array.from(document.querySelectorAll('.window-settings button')).some(b=>b.textContent==='退出游戏'&&!b.disabled)`),'settings exposes the real quit action');
  const bookmark = label => '.pet-bookmarks button[aria-label="'+label+'"]';
  const navigationSnapshot=()=>evaluate(`(async()=>{const s=await window.desktopPet.getState();const r=document.querySelector('.pet-bookmarks').getBoundingClientRect();return {bounds:s.layout.bounds,panel:s.layout.panel,bookmarks:[r.x,r.y,r.width,r.height]}})()`);
  const navStart=await navigationSnapshot();
  assert(await evaluate(`JSON.stringify([...document.querySelectorAll('.pet-bookmarks button')].map(b=>b.getAttribute('aria-label')))===JSON.stringify(['状态','行动','库存','图鉴','设置'])&&JSON.stringify([...document.querySelectorAll('.pet-bubbles button')].map(b=>b.getAttribute('aria-label')))===JSON.stringify(['状态','行动','库存','图鉴','设置'])`),'bookmarks and bubbles share the requested order');
  await textButton('关于');
  for(const label of ['状态','行动','库存','图鉴','设置']) {
    await click(bookmark(label));
    assert(JSON.stringify(await navigationSnapshot())===JSON.stringify(navStart),'switching to '+label+' keeps native window, frame and bookmarks fixed');
    assert(await evaluate(`document.querySelector('.pet-bookmarks button[aria-current="page"]').getAttribute('aria-label')===${JSON.stringify(label)}`),'active bookmark identifies '+label);
    await shot('bookmark-'+label);
  }
  assert(await evaluate(`!!document.querySelector('.window-settings .st-about')`),'settings subpage survives bookmark switching');
  for(const theme of ['light','dark']) {
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
    assert(await evaluate(`(()=>{const active=document.querySelector('.pet-bookmarks button[aria-current="page"]'),panel=document.querySelector('.window-settings'),r=active.getBoundingClientRect(),p=panel.getBoundingClientRect();return getComputedStyle(active).borderRightWidth==='0px'&&getComputedStyle(active).backgroundColor===getComputedStyle(panel).backgroundColor&&document.elementFromPoint(p.left+.25,r.top+r.height/2)?.closest('button')===active&&[...document.querySelectorAll('.pet-bookmarks button:not([aria-current="page"])')].every(b=>getComputedStyle(b,'::after').content!=='none'&&getComputedStyle(b,'::after').backgroundColor.includes('0.45'))&&getComputedStyle(active,'::after').content==='none'})()`),'inactive bookmarks have a gray overlay and the selected seam is covered in '+theme+' mode');
    await shot('bookmark-selection-'+theme);
  }
  const beforeNavigation=await stored();
  await click(bookmark('行动')); await click('.ap-pet-card');
  await click(bookmark('库存')); await click(bookmark('行动'));
  assert(await evaluate(`document.querySelector('.ap-pet-card').getAttribute('aria-pressed')==='true'`),'unsubmitted expedition team survives bookmark switching');
  assert(JSON.stringify(await stored())===JSON.stringify(beforeNavigation),'bookmark switching does not commit or cancel game actions');
  await click(bookmark('设置'));
  await click(bookmark('设置'));
  assert(await evaluate(`!document.querySelector('.pet-panel-host').hidden`),'clicking the current bookmark does not close the panel');
  await evaluate(`document.querySelector('.window-settings .sp-tabs button:first-child').click()`);
  await evaluate(`Array.from(document.querySelectorAll('.window-settings button')).find(b=>b.textContent==='清空本地存档').click()`);
  await waitFor(`[...document.querySelectorAll('.pet-bookmarks button')].every(b=>b.disabled)`);
  await click(bookmark('库存'));
  assert(await evaluate(`!!document.querySelector('.window-settings .st-reset-dialog')&&document.querySelector('.pet-bookmarks button[aria-current="page"]').getAttribute('aria-label')==='设置'`),'confirmation modal blocks bookmark navigation');
  await evaluate(`document.querySelector('.window-settings .st-reset-actions button:nth-child(2)').click()`);
  await waitFor(`[...document.querySelectorAll('.pet-bookmarks button')].every(b=>!b.disabled)`);
  assert(await evaluate(`[...document.querySelectorAll('.pet-bookmarks button')].every(b=>{const r=b.getBoundingClientRect();return r.width===44&&r.height===48&&r.x>=0&&r.bottom<=innerHeight&&!!b.title})`),'fixed bookmark targets and hover labels fit in the native window');
  await shot('13-bookmarks');
  // Compact-work-area geometry is unit tested; exercise content scrolling at that size here.
  await evaluate(`Object.assign(document.querySelector('.pet-panel-host').style,{width:'740px',height:'584px'})`);
  assert(await evaluate(`(()=>{const p=document.querySelector('.window-settings'),s=p.querySelector('.sp-content'),r=p.querySelector('.sp-close').getBoundingClientRect(),b=p.getBoundingClientRect();return s.scrollHeight>s.clientHeight&&r.top>=b.top&&r.bottom<=b.bottom})()`),'compact settings scrolls content without hiding the close button');
  await shot('14-compact-bookmarks');
  await click('.window-settings .sp-close');
  assert(await evaluate(`document.querySelector('.pet-panel-host').hidden&&document.querySelector('.pet-bookmarks').getClientRects().length===0`),'closing the panel also hides every bookmark');
  assert(errors.length===0,'simple panels have no renderer exceptions');
  writeFileSync(join(out,settingsOnly?'settings-result.json':'result.json'),JSON.stringify({passed:true,scope:settingsOnly?'settings':'all-simple-panels',profile,errors},null,2));
  console.log('Screenshots: '+out);
} catch(error){console.error(error);console.error(logs);process.exitCode=1;}
finally{ws?.close();child.kill();}
