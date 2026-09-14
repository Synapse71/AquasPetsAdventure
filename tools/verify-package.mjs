// Validate the actual shipped archive, not the working tree or ignore rules.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as asar from '@electron/asar';

const archives = process.argv.slice(2);
assert(archives.length, 'Pass one or more app.asar paths');
for (const archive of archives) {
  const files = asar.listPackage(archive).map(file => file.replace(/^\//, '')).filter(file => !asar.statFile(archive, file).files);
  const allowed = file => file.startsWith('dist/') || [
    'desktop/main.cjs', 'desktop/preload.cjs', 'desktop/geometry.mjs', 'package.json',
    'public/icons/aquamarine-1024.png', 'public/pet-sprites/standing.png',
  ].includes(file);
  assert.deepEqual(files.filter(file => !allowed(file)), [], 'Unexpected files in packaged game');
  assert(!files.some(file => /(^|\/)(\.env|\.claude|\.codex|\.agents|\.git|node_modules|raw-videos|frames)(\/|$)|\.map$/.test(file)), 'Development/private artifacts must not be packaged');
  for (const file of ['package.json', 'desktop/main.cjs', 'desktop/preload.cjs', 'desktop/geometry.mjs', 'dist/index.html', 'dist/pet-sprites/standing.png', 'dist/pet-sprites/manifest.json', 'public/icons/aquamarine-1024.png']) {
    assert(files.includes(file), `Missing runtime file: ${file}`);
  }
  const manifest = JSON.parse(asar.extractFile(archive, 'dist/pet-sprites/manifest.json').toString());
  for (const clip of Object.values(manifest)) assert(files.includes(`dist/pet-sprites/${clip.file}`), `Missing animation: ${clip.file}`);
  for (const file of files.filter(file => /\.(?:html|css|js|cjs|mjs|json)$/.test(file))) {
    const content = asar.extractFile(archive, file).toString();
    assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/.test(content), `Credential-like content in ${file}`);
  }
  console.log(JSON.stringify({ archive, files: files.length, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'), status: 'PASS' }));
}
