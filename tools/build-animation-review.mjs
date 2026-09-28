// Offline review page: inline manifest avoids file:// fetch restrictions.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('public/pet-sprites/manifest.json',root),'utf8'));
const template=readFileSync(new URL('tools/pet-animation-review.html',root),'utf8');
const target=new URL('artifacts/arrival-matte-final/preview.html',root);
mkdirSync(new URL('./',target),{recursive:true});
writeFileSync(target,template.replace('/*MANIFEST*/',JSON.stringify(manifest).replaceAll('<','\\u003c')));
console.log(fileURLToPath(target));
