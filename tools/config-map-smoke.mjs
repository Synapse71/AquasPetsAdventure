// 地图编辑「点拓扑图节点 → 浮层表单 → 保存」的真交互校验。
// 用 CDP 派发真实鼠标事件做命中测试：样式生效 ≠ 事件送达（灯泡那次的教训）。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import electron from 'electron';

const DRAFT_KEY = 'idle-pet-adventure.catalog.draft.v6';
const port = 9600 + (process.pid % 300);
const vitePort = 5400 + (process.pid % 300);
const profile = mkdtempSync(join(tmpdir(), 'idle-config-map-smoke-'));
const out = resolve('artifacts/config-map-smoke');
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));

const server = await createServer({ server: { host: '127.0.0.1', port: vitePort, strictPort: true } });
await server.listen();
const child = spawn(electron, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'tools/config-editor-main.cjs'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, IDLE_CONFIG_URL: `http://127.0.0.1:${vitePort}/?config=1` },
});
let logs = '';
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });

let ws;
let failed = 0;
try {
  let target;
  for (let i = 0; i < 120; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url.includes('config=1')); } catch {}
    if (target) break;
    if (child.exitCode !== null) throw new Error(`Electron exited ${child.exitCode}: ${logs}`);
    await sleep(150);
  }
  if (!target) throw new Error('No config renderer: ' + logs);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });
  let id = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const callback = pending.get(message.id); pending.delete(message.id); callback?.(message); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  };
  const send = (method, params = {}) => new Promise((done, fail) => {
    const key = ++id;
    const timeout = setTimeout(() => fail(new Error(`Timed out: ${method}`)), 10000);
    pending.set(key, message => { clearTimeout(timeout); if (message.error) fail(new Error(JSON.stringify(message.error))); else done(message.result); });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const assert = (value, message) => {
    if (value) { console.log('✓ ' + message); return; }
    failed += 1; console.log('✗ ' + message);
  };
  const waitFor = async expression => {
    for (let i = 0; i < 200; i++) {
      try { if (await evaluate(expression)) return; } catch {}
      await sleep(100);
    }
    throw new Error('Condition not met: ' + expression);
  };
  // Page.reload 立刻返回，直接 waitFor 会命中导航前的旧 DOM。
  // 先在旧文档上打标记，等标记消失才算真的换了文档。
  const reload = async () => {
    await evaluate(`window.__smokeGeneration = 1`);
    await send('Page.reload');
    await waitFor(`window.__smokeGeneration === undefined && !!document.querySelector('.config-editor-head h2')`);
    await waitFor(`!!document.querySelector('.config-map-graph svg')`);
  };
  const shot = async name => {
    const capture = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, name + '.png'), Buffer.from(capture.data, 'base64'));
  };
  // 真鼠标点击：拿元素的视口坐标，走 Input.dispatchMouseEvent，
  // 中间隔着什么盖住了都会在这里暴露出来。
  const realClick = async selector => {
    const box = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height};})()`);
    if (!box || box.w < 1 || box.h < 1) throw new Error(`No clickable box for ${selector}: ${JSON.stringify(box)}`);
    const hit = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!top && (e===top||e.contains(top));})()`);
    if (!hit) {
      const why = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);const m=document.querySelector('.config-node-modal');return JSON.stringify({target:r,viewport:{w:innerWidth,h:innerHeight},modal:m&&m.getBoundingClientRect(),topAt:top&&top.className});})()`);
      throw new Error(`Element is covered at its centre: ${selector}\n  ${why}`);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none', buttons: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(300);
  };
  const pressKey = async (key, code, windowsVirtualKeyCode) => {
    for (const type of ['rawKeyDown', 'char', 'keyUp']) {
      if (type === 'char' && key !== 'Enter') continue;
      await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode, text: key === 'Enter' ? '\r' : undefined });
    }
    await sleep(300);
  };
  const setInput = async (selector, value) => {
    await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await sleep(200);
  };
  // 正在编辑的记录 id 就写在 .config-editor-head 的标题里，不用去猜。
  const currentMapId = () => evaluate(`document.querySelector('.config-editor-head h2').textContent.trim()`);
  const savedNode = async nodeId => {
    const mapId = await currentMapId();
    return evaluate(`(()=>{const raw=localStorage.getItem(${JSON.stringify(DRAFT_KEY)});if(!raw)return null;const map=JSON.parse(raw).maps?.[${JSON.stringify(mapId)}];return map?.nodes?.[${JSON.stringify(nodeId)}] ?? null;})()`);
  };

  await send('Runtime.enable'); await send('Page.enable');
  await waitFor(`!!document.querySelector('.config-map-graph svg')`);
  const mapId = await currentMapId();
  console.log('map under test:', mapId);

  const nodeId = await evaluate(`document.querySelector('.config-graph-node[data-node-id]').dataset.nodeId`);
  assert(Boolean(nodeId), `拓扑图节点带上了 data-node-id（${nodeId}）`);
  assert(await evaluate(`!document.querySelector('.config-node-modal')`), '初始状态没有展开任何节点表单');
  assert(await evaluate(`!document.querySelector('.config-node-loot-body')`), '节点表单不再整列铺在页面上');
  await shot('01-graph');

  // ① 真鼠标点节点 → 浮层出现
  await realClick(`.config-graph-node[data-node-id="${nodeId}"]`);
  assert(await evaluate(`document.querySelector('.config-node-modal')?.dataset.nodeId === ${JSON.stringify(nodeId)}`), '真鼠标点击拓扑图节点后弹出了对应节点的编辑浮层');
  assert(await evaluate(`document.querySelector('.config-graph-node[data-node-id=${JSON.stringify(nodeId)}]').classList.contains('selected')`), '被编辑的节点在图上高亮');
  assert(await evaluate(`document.querySelector('.config-node-modal-save').disabled`), '没有改动时保存按钮是禁用的');
  await shot('02-modal');

  // ② 改名字 → 变脏但还没落盘
  const renamed = `冒烟改名-${Date.now() % 100000}`;
  await setInput('.config-node-modal-body input', renamed);
  assert(await evaluate(`document.querySelector('.config-node-modal-state').textContent.includes('未保存')`), '改动后浮层提示有未保存内容');
  assert(!(await evaluate(`document.querySelector('.config-node-modal-save').disabled`)), '有改动后保存按钮可点');
  assert((await savedNode(nodeId))?.name !== renamed, '点保存之前改动没有落到 localStorage');

  // ③ 保存 → 一次点击直接落到 catalog 草稿，浮层关闭
  await realClick('.config-node-modal-save');
  assert(await evaluate(`!document.querySelector('.config-node-modal')`), '保存后浮层自动关闭');
  assert((await savedNode(nodeId))?.name === renamed, '保存一次就写进了 localStorage 的 catalog 草稿');
  assert(await evaluate(`document.querySelector('.config-save').textContent.trim() === '保存这条记录'`), '保存后底部总保存不再显示「有未保存修改」');
  await shot('03-saved');

  // ④ 刷新后仍在：证明是真落盘，不是只改了内存
  await reload();
  assert((await savedNode(nodeId))?.name === renamed, '刷新页面后改名仍然保留');
  assert(await evaluate(`[...document.querySelectorAll('.config-graph-node .name')].some(t => t.textContent.startsWith('冒烟改名'))`), '刷新后拓扑图上显示的是新名字');

  // ⑤ 取消放弃改动
  await realClick(`.config-graph-node[data-node-id="${nodeId}"]`);
  await setInput('.config-node-modal-body input', '不该被保存的名字');
  await evaluate(`window.confirm = () => true`);
  await realClick('.config-node-modal-cancel');
  assert(await evaluate(`!document.querySelector('.config-node-modal')`), '取消后浮层关闭');
  assert((await savedNode(nodeId))?.name === renamed, '取消丢弃了改动，草稿仍是上一次保存的值');

  // ⑥ 新增节点 → 直接进入它的编辑浮层，不用再去图上找
  const created = `smoke-node-${Date.now() % 100000}`;
  await setInput('.config-node-create input', created);
  await realClick('.config-node-create button');
  assert(await evaluate(`document.querySelector('.config-node-modal')?.dataset.nodeId === ${JSON.stringify(created)}`), '新增节点后自动打开它的编辑浮层');
  // 新节点表单最长（掉落+权重+名单+事件池+路线），底部保存栏必须仍在视口内。
  const box = await evaluate(`(()=>{const r=document.querySelector('.config-node-modal').getBoundingClientRect();const f=document.querySelector('.config-node-modal-foot').getBoundingClientRect();return {bottom:r.bottom,footBottom:f.bottom,h:innerHeight};})()`);
  assert(box.bottom <= box.h && box.footBottom <= box.h, `长表单的浮层被夹在视口内，保存栏可见（浮层 ${Math.round(box.bottom)} / 视口 ${box.h}）`);
  assert(await evaluate(`document.querySelector('.config-node-modal-body').scrollHeight > document.querySelector('.config-node-modal-body').clientHeight`), '超长表单在浮层内部滚动，而不是把页面撑长');
  await setInput('.config-node-modal-body input', '冒烟新节点');
  await realClick('.config-node-modal-save');
  assert((await savedNode(created))?.name === '冒烟新节点', '新节点保存一次即落盘');
  assert(await evaluate(`[...document.querySelectorAll('.config-graph-node')].some(g => g.dataset.nodeId === ${JSON.stringify(created)})`), '新节点出现在拓扑图上');
  await shot('04-new-node');

  // ⑦ 浮层里删除节点：确认后落盘并收起浮层
  await realClick(`.config-graph-node[data-node-id="${created}"]`);
  await evaluate(`window.confirm = () => true`);
  await realClick('.config-node-modal-delete');
  assert(await evaluate(`!document.querySelector('.config-node-modal')`), '删除节点后浮层关闭');
  assert((await savedNode(created)) === null, '删除节点直接写进了草稿');
  assert(await evaluate(`![...document.querySelectorAll('.config-graph-node')].some(g => g.dataset.nodeId === ${JSON.stringify(created)})`), '被删的节点从拓扑图上消失');

  // ⑧ 换一张层级更深的地图，确认命中测试在缩放/滚动后的图上依然成立
  await realClick('.config-record-list button:nth-of-type(2)');
  await waitFor(`document.querySelector('.config-editor-head h2').textContent.trim() !== ${JSON.stringify(mapId)}`);
  console.log('second map under test:', await currentMapId());
  const deepNode = await evaluate(`[...document.querySelectorAll('.config-graph-node[data-node-id]')].at(-1).dataset.nodeId`);
  await realClick(`.config-graph-node[data-node-id="${deepNode}"]`);
  assert(await evaluate(`document.querySelector('.config-node-modal')?.dataset.nodeId === ${JSON.stringify(deepNode)}`), `另一张地图上最末层的节点也点得开（${deepNode}）`);
  await shot('05-second-map');
  await evaluate(`window.confirm = () => true`);
  await realClick('.config-node-modal-cancel');

  // ⑨ 键盘通路：Tab 能聚焦到图上的节点，Enter 打开、Esc 关闭
  const focused = await evaluate(`(()=>{const g=document.querySelector('.config-graph-node[data-node-id]');g.focus();return document.activeElement===g;})()`);
  assert(focused, 'SVG 节点可以获得键盘焦点');
  await pressKey('Enter', 'Enter', 13);
  assert(await evaluate(`!!document.querySelector('.config-node-modal')`), '真键盘 Enter 也能打开节点浮层');
  await pressKey('Escape', 'Escape', 27);
  assert(await evaluate(`!document.querySelector('.config-node-modal')`), '真键盘 Esc 关闭浮层');

  assert(errors.length === 0, `渲染过程没有未捕获异常（${errors.length}）`);
  console.log(`\n截图：${out}`);
} finally {
  ws?.close();
  child.kill();
  await server.close();
}
if (failed) { console.error(`\n${failed} 条断言未通过`); process.exit(1); }
console.log('\n全部断言通过');
process.exit(0);
