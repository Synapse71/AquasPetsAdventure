#!/usr/bin/env node
// 跑齐所有原型的规则校验。必须从项目根目录执行：
//   node tools/checks/run-all.mjs
// 这些脚本一度放在 /tmp 的 scratchpad 里，被系统清理掉过四个——
// 校验是回归资产，必须跟着仓库走。
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const files = readdirSync(dir).filter(f => f.endsWith('-verify.mjs')).sort();
let total = 0, failed = [];
for (const f of files) {
  const name = f.replace('-verify.mjs', '');
  try {
    const out = execFileSync('node', [path.join(dir, f)], { encoding: 'utf8' });
    const n = (out.match(/^✓/gm) || []).length;
    total += n;
    console.log(`✓ ${name.padEnd(10)} ${n} 条`);
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    const bad = (out.match(/^✗.*$/gm) || []).slice(0, 3);
    console.error(`✗ ${name.padEnd(10)} 失败`);
    bad.forEach(l => console.error(`    ${l}`));
    failed.push(name);
  }
}
console.log(failed.length ? `\n✗ ${failed.join(', ')} 未通过` : `\n全部通过，共 ${total} 条`);
process.exit(failed.length ? 1 : 0);
