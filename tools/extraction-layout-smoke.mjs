// Real Electron integration checks in an isolated profile; never touch the player's save.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

const port = 9500 + process.pid % 400;
const profile = mkdtempSync(join(tmpdir(), 'idle-extraction-layout-smoke-'));
const out = resolve('artifacts/extraction-layout-smoke');
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
    // Target the renderer element directly; desktop-smoke separately covers native pointer input.
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await sleep(450);
  };
  const shot = async name => {
    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, name + '.png'), Buffer.from(capture.data, 'base64'));
  };




  await send('Runtime.enable'); await send('Page.enable');
  const loaded=()=>waitFor(`!!document.querySelector('.pet-hit canvas[data-pose]')`);
  const open=async()=>{await click('.pet-hit');await click('.pet-bubbles button[aria-label="行动"]');};

  await loaded();await open();await click('.ap-pet-card');await click('.ap-footer .ap-primary');await click('.ap-footer .ap-primary');await click('.pickable .ap-map-node');await click('.ap-footer .ap-primary');await click('.ap-footer .ap-primary');
  const fixture=await evaluate("JSON.parse(localStorage.getItem('idle-pet-adventure.demo.v1'))");
  const e=fixture.expeditions[0];e.phase='extraction';e.currentNodeId='m1-goal-1';e.cargo={paper:3,'cloth-strip':2};e.initialCargo={};fixture.inventory={paper:8};fixture.warehouseSlots=40;
  const seed=async()=>{await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1',${JSON.stringify(JSON.stringify(fixture))});Object.keys(localStorage).filter(k=>k.startsWith('idle-pet.ui.v1.')).forEach(k=>localStorage.removeItem(k));`);await send('Page.reload');await loaded();await open();await click('.ap-team-list button');};
  await seed();
  const measure=()=>evaluate(`Array.from(document.querySelectorAll('.ap-extraction .ap-transfer .ap-items')).map(g=>({height:g.clientHeight,scroll:g.scrollHeight,rowSize:getComputedStyle(g).gridTemplateRows,cells:Array.from(g.querySelectorAll('.ap-item')).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})}))`);
  const check=async label=>{
    const grids=await measure();writeFileSync(join(out,label+'.json'),JSON.stringify(grids,null,2));
    const bad=grids.flatMap(g=>g.cells.filter((c,i)=>Math.abs(c.w-c.h)>1||(i>=6&&c.y<g.cells[i-6].y+g.cells[i-6].h+4)));
    assert(bad.length===0,label+': square cells with non-overlapping rows: '+JSON.stringify(bad.slice(0,4)));
    assert(grids[1].scroll>grids[1].height,label+': warehouse overflows by scrolling instead of squeezing cells');
  };
  await shot('01-before-transfer');await check('40-slots');
  await evaluate("Array.from(document.querySelectorAll('.ap-inline-actions button')).find(b=>b.textContent==='全部入库').click()");await sleep(200);
  await shot('02-after-transfer');await check('40-slots-transferred');
  await evaluate("document.querySelector('.ap-transfer section:last-child .ap-items').scrollTop=10000");await sleep(200);
  assert(await evaluate("(()=>{const g=document.querySelector('.ap-transfer section:last-child .ap-items'),last=Array.from(g.querySelectorAll('.ap-item')).at(-1).getBoundingClientRect(),r=g.getBoundingClientRect();return last.bottom<=r.bottom+1&&last.top>=r.top})()"),'last warehouse row remains accessible');
  fixture.warehouseSlots=120;await seed();await check('120-slots');
  assert(errors.length===0,'no renderer exceptions');
  writeFileSync(join(out,'result.json'),JSON.stringify({passed:true,profile,errors},null,2));
} catch(error) {console.error(error);console.error(logs);process.exitCode=1;}
finally {ws?.close();child.kill();}
