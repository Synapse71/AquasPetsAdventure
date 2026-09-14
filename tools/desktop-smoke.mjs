// Real Electron integration checks in an isolated profile; never touch the player's save.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

const port = 9500 + process.pid % 400;
const profile = mkdtempSync(join(tmpdir(), 'idle-desktop-smoke-'));
const positionCheck = process.argv.includes('--position-check');
const out = resolve(positionCheck ? 'artifacts/desktop-position-smoke' : 'artifacts/desktop-smoke');
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
  await waitFor(`!!document.querySelector('.pet-hit canvas')?.getContext('2d').getImageData(150,180,1,1).data[3]`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await evaluate(`document.querySelector('.pet-hit').focus()`);
  const petFocus = await evaluate(`(()=>{const e=document.querySelector('.pet-hit');return {active:document.activeElement===e,visible:e.matches(':focus-visible'),outline:getComputedStyle(e).outlineStyle}})()`);
  assert(petFocus.active && petFocus.visible && petFocus.outline === 'none', 'pet keyboard focus never draws a rectangular outline: ' + JSON.stringify(petFocus));
  await evaluate(`document.querySelector('.pet-hit').blur()`);
  if (positionCheck) {
    await sleep(300);
    await evaluate(`(() => {
      window.positionSamples = [];
      window.samplePosition = true;
      const sample = () => {
        const r = document.querySelector('.pet-anchor').getBoundingClientRect();
        window.positionSamples.push({ x: screenX + r.x, y: screenY + r.y,
          screenX, screenY, localX: r.x, localY: r.y, width: innerWidth, height: innerHeight,
          panel: !document.querySelector('.pet-panel-host').hidden, time: performance.now() });
        if (window.samplePosition) requestAnimationFrame(sample);
      };
      sample();
    })()`);
    for (let i = 0; i < 12; i++) {
      await click('.pet-hit');
      await click('.pet-bubbles button[aria-label="' + (i % 2 ? '库存' : '状态') + '"]');
      await click('.pet-hit');
    }
    const samples = await evaluate(`(window.samplePosition = false, window.positionSamples)`);
    const baseline = samples[0];
    const drift = samples.filter(s => Math.abs(s.x - baseline.x) > 1 || Math.abs(s.y - baseline.y) > 1);
    writeFileSync(join(out, 'positions.json'), JSON.stringify({ baseline, drift, samples }, null, 2));
    assert(drift.length === 0, `pet remains screen-stationary on every frame (${drift.length}/${samples.length} displaced frames)`);
    const geometryChecks = await evaluate(`(async () => {
      const before = await window.desktopPet.getState();
      window.desktopPet.startDrag({x: 100, y: 100});
      window.desktopPet.dragTo({x: 40, y: 60});
      window.desktopPet.endDrag();
      const dragged = await window.desktopPet.getState();
      const resized = await window.desktopPet.settings({canvas: 260});
      const restored = await window.desktopPet.settings({canvas: before.canvas});
      return {before, dragged, resized, restored};
    })()`);
    assert(geometryChecks.dragged.layout.position.x === geometryChecks.before.layout.position.x - 60
      && geometryChecks.dragged.layout.position.y === geometryChecks.before.layout.position.y - 40,
      'explicit dragging still moves the pet by the requested screen delta');
    assert(geometryChecks.resized.canvas === 260 && geometryChecks.resized.layout.pet.width === 260
      && geometryChecks.restored.canvas === geometryChecks.before.canvas,
      'explicit size changes still resize the pet and can restore its size');
  }
  assert(await evaluate(`!!window.desktopPet && !document.querySelector('.pet-panel-host:not([hidden])')`), 'native bridge available; startup panel closed');
  assert(await evaluate(`document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data[3] === 0`), 'pet canvas retains transparent pixels');
  await shot('01-pet');
  await click('.pet-hit');
  assert(await evaluate(`document.querySelectorAll('.pet-bubbles.open button').length === 5`), 'pet click opens five menu buttons');
  await shot('02-menu');
  await click('.pet-bubbles button[aria-label="状态"]');
  await waitFor(`document.querySelector('.pet-panel-host:not([hidden]) .window-pets')?.getBoundingClientRect().width === 812`);
  assert(await evaluate(`document.querySelector('.window-pets h1').textContent === '状态'`), 'status opens an 812px real game panel');
  await shot('03-status');
  assert(await evaluate(`(() => { const s = getComputedStyle(document.querySelector('.window-pets')); return s.boxShadow === 'none' && s.borderTopColor === 'rgb(174, 178, 186)' && s.borderTopWidth === '1px'; })()`), 'status panel has no shadow and a 1px gray border');
  await evaluate(`window.dispatchEvent(new Event('blur'))`); await sleep(300);
  assert(await evaluate(`document.querySelector('.pet-panel-host').hidden`), 'blur folds the panel');
  await click('.pet-hit'); await click('.pet-bubbles button[aria-label="行动"]');
  await waitFor(`!!document.querySelector('.window-adventure')`);
  assert(await evaluate(`(() => { const s = getComputedStyle(document.querySelector('.window-adventure')); return s.boxShadow === 'none' && s.borderTopColor === 'rgb(174, 178, 186)'; })()`), 'other panels share the shadow-free gray border');
  await click('.window-adventure .ap-pet-card');
  assert(await evaluate(`document.querySelector('.window-adventure .ap-pet-card').getAttribute('aria-pressed')==='true'`), 'dispatch draft can select a real pet');
  await send('Page.reload');
  await waitFor(`!!document.querySelector('.pet-hit canvas')?.getContext('2d').getImageData(150,180,1,1).data[3]`);
  assert(await evaluate(`document.querySelector('.pet-panel-host').hidden`), 'reload starts with panels folded');
  await click('.pet-hit'); await click('.pet-bubbles button[aria-label="行动"]');
  assert(await evaluate(`document.querySelector('.window-adventure .ap-pet-card').getAttribute('aria-pressed')==='true'`), 'unconfirmed dispatch selection survives reload');
  for (let step = 0; step < 4; step++) await click('.window-adventure .ap-footer .ap-primary');
  assert(await evaluate(`document.querySelector('.window-adventure').textContent.includes('行进中')`), 'dispatch calls the real engine and opens the expedition');
  await shot('04-adventure');
  await evaluate(`window.dispatchEvent(new Event('blur'))`); await sleep(300);
  await waitFor(`!!document.querySelector('.pet-bulb')`);
  await click('.pet-bulb');
  assert(await evaluate(`!!document.querySelector('.window-adventure .ap-choices') && document.querySelector('.window-adventure').textContent.includes('选择下一条路线')`), 'bulb prioritizes expedition decisions');
  await evaluate(`window.dispatchEvent(new Event('blur'))`); await sleep(300);
  await click('.pet-hit'); await click('.pet-bubbles button[aria-label="设置"]');
  assert(await evaluate(`Array.from(document.querySelectorAll('.window-settings button')).some(b => b.textContent === '退出游戏')`), 'settings includes quit');
  await shot('05-settings');
  assert(errors.length === 0, 'no renderer runtime exceptions');
  writeFileSync(join(out, 'result.json'), JSON.stringify({ passed: true, profile, errors }, null, 2));
  console.log(`Screenshots: ${out}`);
} catch (error) {
  console.error(error); console.error(logs); process.exitCode = 1;
} finally { ws?.close(); child.kill(); }
