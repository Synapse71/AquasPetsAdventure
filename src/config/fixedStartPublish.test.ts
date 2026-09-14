import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { catalogPublishPlugin } from '../../configPublishPlugin';
import { bundledCatalog } from '../domain/catalog';

it('previews and writes the same normalized 15-second catalog', async () => {
  const root=await mkdtemp(join(tmpdir(),'idle-fixed-start-'));
  try {
    await mkdir(join(root,'src/domain'),{recursive:true});
    const target=join(root,'src/domain/catalog.bundled.json');
    await writeFile(target,JSON.stringify(bundledCatalog));
    let handler!: (req:IncomingMessage,res:ServerResponse,next:()=>void)=>Promise<void>;
    const plugin=catalogPublishPlugin(root);
    const configure=plugin.configureServer as (s:unknown)=>void;
    configure({middlewares:{use:(h:typeof handler)=>{handler=h;}}});
    const call=async (url:string,body:unknown) => {
      const request=Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{url,method:'POST'});
      let result!: {ok:boolean;currentFingerprint:string;candidateFingerprint:string};
      const response={statusCode:0,setHeader:()=>{},end:(value:string)=>{result=JSON.parse(value);}};
      await handler(request as IncomingMessage,response as unknown as ServerResponse,()=>{});
      expect(response.statusCode).toBe(200);
      return result;
    };
    const candidate=structuredClone(bundledCatalog);
    Object.values(candidate.maps).forEach(m=>{m.startDurationMs=8000;});
    const preview=await call('/__idle-config/preview-publish',{catalog:candidate});
    expect(preview.ok).toBe(true);
    const result=await call('/__idle-config/publish-bundled',{catalog:candidate,expectedFingerprint:preview.currentFingerprint,expectedCandidateFingerprint:preview.candidateFingerprint});
    expect(result.ok).toBe(true);
    const saved=JSON.parse(await readFile(target,'utf8')) as typeof bundledCatalog;
    expect(Object.values(saved.maps).every(m=>m.startDurationMs===15000)).toBe(true);
  } finally { await rm(root,{recursive:true,force:true}); }
});
