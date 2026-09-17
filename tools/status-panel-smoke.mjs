// Real Electron integration checks in an isolated profile; never touch the player's save.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

const port = 9500 + process.pid % 400;
const profile = mkdtempSync(join(tmpdir(), 'idle-status-smoke-'));
const out = resolve('artifacts/status-panel-smoke');
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
    const rect = await evaluate(`(() => {const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...rect });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...rect });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...rect });
    await sleep(450);
  };
  const shot = async name => {
    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, name + '.png'), Buffer.from(capture.data, 'base64'));
  };

  await send('Runtime.enable'); await send('Page.enable');
  const loaded = () => waitFor(`!!document.querySelector('.pet-hit canvas')?.getContext('2d').getImageData(150,180,1,1).data[3]`);
  const openStatus = async () => { await click('.pet-hit'); await click('.pet-bubbles button[aria-label="状态"]'); await waitFor(`!!document.querySelector('.pet-panel-host:not([hidden]) .pet-status-panel')`); };
  const stored = () => evaluate(`JSON.parse(localStorage.getItem('idle-pet-adventure.demo.v1'))`);
  const reload = async () => { await send('Page.reload'); await loaded(); await openStatus(); };
  await loaded();
  const initial = await stored(), petId = Object.keys(initial.pets)[0];
  const fixture = structuredClone(initial), pet = fixture.pets[petId];
  Object.assign(pet, {level:3,xp:22,unspentPoints:3,baseStats:{fitness:2,perception:2,technique:2},
    allocatedStats:{fitness:0,perception:0,technique:0},secondaryStats:{eloquence:2,lore:3,courage:1,guile:2},injury:'healthy'});
  fixture.currency = 550; fixture.statResetCount = 0;
  fixture.pets.second = {...structuredClone(pet), id:'second', name:'第二只测试宠物', unspentPoints:2, allocatedStats:{fitness:1,perception:0,technique:0}};
  await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1', ${JSON.stringify(JSON.stringify(fixture))})`);
  await reload();
  const dimensions = () => evaluate(`(()=>{const e=document.querySelector('.window-pets');const r=e.getBoundingClientRect();return {width:r.width,height:r.height,scroll:document.querySelector('.pet-status-panel').scrollHeight,client:document.querySelector('.pet-status-panel').clientHeight}})()`);
  const baseline = await dimensions();
  assert(baseline.width === 812 && baseline.height === 750, 'status uses the shared 812x750 frame');
  await shot('01-healthy');
  await click('button[aria-label="给体能加一点"]');
  await click('button[aria-label="给技巧加一点"]');
  let saved = await stored();
  assert(saved.pets[petId].unspentPoints === 3 && saved.pets[petId].allocatedStats.fitness === 0, 'plus buttons preview without committing game state');
  assert(await evaluate(`document.querySelector('[data-testid="carry-capacity"]').textContent.startsWith('8.6') && document.querySelector('[data-testid="slot-capacity"]').textContent.startsWith('11')`), 'draft updates real carry and slot formulas');
  await shot('02-draft');
  await click('.ps-close'); await openStatus();
  assert(await evaluate(`document.querySelector('.ps-confirm').textContent === '确认 2 点'`), 'close and reopen preserves the plan');
  await reload();
  assert(await evaluate(`document.querySelector('.ps-confirm').textContent === '确认 2 点'`), 'reload restores uncommitted UI draft');
  await click('button[aria-label="撤回体能一点"]');
  assert(await evaluate(`document.querySelector('[data-testid="effective-fitness"]').textContent === '2'`), 'minus withdraws a draft point');
  await click('button[aria-label="给体能加一点"]');
  await click('.ps-confirm');
  saved = await stored();
  assert(saved.pets[petId].unspentPoints === 1 && saved.pets[petId].allocatedStats.fitness === 1 && saved.pets[petId].allocatedStats.technique === 1, 'confirm commits all drafted stats once');
  await reload();
  assert(await evaluate(`document.querySelector('.ps-actions').classList.contains('is-idle')`), 'committed draft is never replayed on reload');
  await click('.ps-reset');
  assert(await evaluate(`document.querySelector('.ps-actions').textContent.includes('首次免费')`), 'first reset clearly displays free fee');
  await shot('03-reset-confirm');
  await click('.ps-actions button:not(.ps-danger)');
  assert((await stored()).statResetCount === 0, 'cancel reset does not count or charge');
  await click('.ps-reset'); await click('.ps-danger');
  saved = await stored();
  assert(saved.statResetCount === 1 && saved.currency === 550 && saved.pets[petId].unspentPoints === 3, 'first confirmed reset refunds points for free');
  await click('button[aria-label="给感知加一点"]'); await click('.ps-confirm');
  await click('.ps-reset');
  assert(await evaluate(`document.querySelector('.ps-actions .ps-money').textContent === '500'`), 'second reset displays 500 currency');
  await click('.ps-danger');
  saved = await stored();
  assert(saved.statResetCount === 2 && saved.currency === 50, 'second reset charges exactly 500 once');
  await evaluate(`(()=>{const e=document.querySelector('.ps-identity select');e.value='second';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('.ps-reset');
  assert(await evaluate(`document.querySelector('.ps-danger').disabled && document.querySelector('.ps-actions .ps-money').textContent === '2,000'`), 'other pet shares the 2000 tier and insufficient funds disables confirmation');
  await shot('04-insufficient');
  await click('.ps-actions button:not(.ps-danger)');
  const injured = await stored();
  injured.pets[petId].injury = 'injured';
  injured.pets[petId].injuryRecoveredAt = Date.now() + 1800000;
  await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1',${JSON.stringify(JSON.stringify(injured))}); localStorage.setItem('idle-pet.ui.v1.status-pet',${JSON.stringify(JSON.stringify(petId))})`);
  await reload();
  assert(await evaluate(`document.querySelector('[data-testid="effective-fitness"]').textContent === '1' && document.querySelector('[data-testid="carry-capacity"]').textContent === '5.6' && document.querySelector('[data-testid="slot-capacity"]').textContent === '10'`), 'injury reduces primary stats and carry but not slots');
  assert(await evaluate(`Array.from(document.querySelectorAll('.ps-secondary strong')).map(e=>e.textContent).join(',') === '2,3,1,2'`), 'secondary attributes are unchanged and have no displayed cap');
  await shot('05-injured');
  injured.currency = 1000;
  await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1',${JSON.stringify(JSON.stringify(injured))})`); await reload();
  await click('button[aria-label="给体能加一点"]'); await click('.ps-heal');
  saved = await stored();
  assert(saved.currency === 800 && saved.pets[petId].injury === 'healthy' && !saved.pets[petId].injuryRecoveredAt, 'healing uses the real engine fee and clears the timer');
  assert(await evaluate(`document.querySelector('.ps-confirm').textContent === '确认 1 点'`), 'healing preserves the pending allocation');
  await click('.ps-actions button:not(.ps-confirm)');
  const incapacitated = await stored();
  incapacitated.pets[petId].injury = 'incapacitated'; incapacitated.pets[petId].injuryRecoveredAt = Date.now()+14400000;
  await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1',${JSON.stringify(JSON.stringify(incapacitated))})`); await reload();
  assert(await evaluate(`document.querySelector('[data-testid="effective-fitness"]').textContent === '0' && document.querySelector('[data-testid="slot-capacity"]').textContent === '10'`), 'incapacitated stage keeps personal slot capacity');
  await shot('06-incapacitated');
  const after = await dimensions();
  assert(after.width === baseline.width && after.height === baseline.height, 'panel size never changes across transactions and injury states');
  assert(errors.length === 0, 'status panel has no renderer exceptions');
  writeFileSync(join(out,'result.json'),JSON.stringify({passed:true,profile,baseline,after,errors},null,2));
  console.log(`Screenshots: ${out}`);
} catch (error) {
  console.error(error); console.error(logs); process.exitCode = 1;
} finally { ws?.close(); child.kill(); }
