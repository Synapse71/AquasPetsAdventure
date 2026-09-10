#!/usr/bin/env node
/**
 * 在真实 Chrome 里打开页面，报告 JS 异常和 console.error。
 *
 *   node tools/page_console.mjs prototypes/pet-menu.html [更多页面...]
 *   node tools/page_console.mjs prototypes/*.html
 *
 * ### 为什么 proto_smoke 不够
 *
 * `proto_smoke.mjs` 用的是最小 DOM 桩，它的 `querySelector` **永远返回一个元素**。
 * 真实浏览器里选择器打偏会返回 null，下一行 `.offsetHeight` 就抛 TypeError，
 * 整个 IIFE 从那里断掉——桩完全看不到。
 *
 * 实际踩过：把 `.pa.idle` 改名成 `.pa.mag` 后，`selfCheck()` 里还查着旧名字，
 * 页面加载即抛错、后面所有交互都没绑定，而 proto_smoke 报「✓ 顶层执行 + 初始渲染」。
 *
 * 两个都要跑：proto_smoke 快、能逐视图渲染；这个慢、但看的是真实运行时。
 *
 * 依赖：Node 18+ 内置 WebSocket + 本机 Chrome。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9400 + (process.pid % 400);
const WAIT_MS = 4000;

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法: node tools/page_console.mjs <页面.html> [...]');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'pageconsole-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu',
  `--remote-debugging-port=${PORT}`, '--window-size=1240,1000',
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
process.on('exit', () => { try { chrome.kill(); } catch {} });

await sleep(2500);
let bad = 0;
for (const f of files) {
  const url = `file://${resolve(f)}`;
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${url}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const waiters = new Map(); const problems = [];
  const send = (m, p = {}) => new Promise(r => {
    const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = ev => {
    const d = JSON.parse(ev.data);
    if (d.id && waiters.has(d.id)) { waiters.get(d.id)(d.result); waiters.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') {
      const e = d.params.exceptionDetails;
      problems.push('异常: ' + (e.exception?.description || e.text).split('\n')[0]);
    }
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error')
      problems.push('console.error: ' + d.params.args.map(a => a.value ?? a.description).join(' '));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(WAIT_MS);
  ws.close();

  if (problems.length) {
    bad++;
    console.log(`✗ ${basename(f)}`);
    for (const p of [...new Set(problems)].slice(0, 5)) console.log(`    ${p}`);
  } else {
    console.log(`✓ ${basename(f)}`);
  }
}
console.log(bad ? `\n✗ ${bad} 个页面有运行时错误` : `\n✓ ${files.length} 个页面无运行时错误`);
process.exit(bad ? 1 : 0);
