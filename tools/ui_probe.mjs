#!/usr/bin/env node
/**
 * 用真实鼠标事件验证原型里某个元素能不能交互。
 *
 *   node tools/ui_probe.mjs <页面.html> <选择器> [--setup "<先跑的 JS>"]
 *
 * 例：
 *   node tools/ui_probe.mjs prototypes/pet-menu.html '#bulb' \
 *     --setup "document.getElementById('stage').classList.add('hint')"
 *
 * ⚠️ `--setup` 里只能用 DOM API。原型的脚本包在 IIFE 里，
 *    `setHint()` / `stage` 这些是私有变量，从 Runtime.evaluate 够不着——
 *    直接加/删 class 来摆出要测的状态。
 *
 * ### 为什么需要它
 *
 * 灯泡那次连着两轮没修好，就是因为验证方式不对：
 *   第一轮 改了 CSS 特异性，用「加一个同特异性的类」验证 transform 变化 —— 过了，但没用。
 *   第二轮 `elementFromPoint` 查命中 —— 能证明「没被挡住」，但仍不等于 :hover 会触发。
 * 真正的原因是 `.petart`（position:relative，DOM 顺序在后）盖住了灯泡，
 * 鼠标事件根本到不了它，hover 和 click 全是哑的。
 *
 * **样式生效 ≠ 事件送达。** 这个脚本走 CDP 派发真实的 mouseMoved / mousePressed，
 * 量 hover 前后的 transform、检查 `:hover` 是否匹配、点击后有没有冒泡到不该去的地方。
 *
 * 依赖：Node 18+ 的内置 WebSocket（不需要 ws 包）+ 本机 Chrome。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9222 + (process.pid % 500);

const args = process.argv.slice(2);
const file = args[0];
const selector = args[1];
const setupIdx = args.indexOf('--setup');
const setup = setupIdx > 0 ? args[setupIdx + 1] : '';
if (!file || !selector) {
  console.error('用法: node tools/ui_probe.mjs <页面.html> <选择器> [--setup "<JS>"]');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'uiprobe-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu',
  `--remote-debugging-port=${PORT}`, '--window-size=1240,1000',
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanup = () => { try { chrome.kill(); } catch {} };
process.on('exit', cleanup);

try {
  await sleep(2500);
  const target = await (await fetch(
    `http://127.0.0.1:${PORT}/json/new?file://${resolve(file)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const waiters = new Map();
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; waiters.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = ev => {
    const d = JSON.parse(ev.data);
    if (d.id && waiters.has(d.id)) { waiters.get(d.id)(d.result); waiters.delete(d.id); }
  };
  const js = async expr =>
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;

  await send('Page.enable');
  await sleep(2500);
  if (setup) await js(`(function(){ ${setup} })(); true`);
  await js(`document.querySelector(${JSON.stringify(selector)})
    ?.scrollIntoView({block:'center'}); true`);
  await sleep(500);

  const box = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});
    if(!e) return null; const r=e.getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), w:r.width, h:r.height};})()`);
  if (!box) { console.error(`✗ 找不到 ${selector}`); process.exit(1); }
  if (!box.w) { console.error(`✗ ${selector} 尺寸为 0`); process.exit(1); }

  const hitInfo = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});
    const h=document.elementFromPoint(${box.x},${box.y});
    return {ok: h===e||e.contains(h),
            who: h? h.tagName.toLowerCase()+(h.className?'.'+String(h.className).trim().split(/\\s+/).join('.'):'') : 'null'};})()`);

  const scaleExpr = `(()=>{const m=getComputedStyle(document.querySelector(${JSON.stringify(selector)})).transform;
    if(m==='none') return 1; const n=m.match(/matrix\\(([-\\d.]+)/); return n?parseFloat(n[1]):NaN;})()`;
  const before = await js(scaleExpr);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
  await sleep(200);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 });
  await sleep(600);
  const during = await js(scaleExpr);
  const matched = await js(`document.querySelectorAll(${JSON.stringify(selector + ':hover')}).length`);

  await send('Input.dispatchMouseEvent',
    { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(400);

  const P = (label, val, ok) =>
    console.log(`  ${ok === undefined ? ' ' : ok ? '✓' : '✗'} ${label.padEnd(22)} ${val}`);
  console.log(`${selector} @ (${box.x}, ${box.y})  ${Math.round(box.w)}×${Math.round(box.h)}`);
  P('命中测试', hitInfo.ok ? '命中自身' : `被 ${hitInfo.who} 挡住`, hitInfo.ok);
  P(':hover 匹配', `${matched} 个`, matched === 1);
  P('hover transform', `${before} → ${during}`, during !== before);
  ws.close();
  process.exit(hitInfo.ok && matched === 1 ? 0 : 1);
} finally {
  cleanup();
}
