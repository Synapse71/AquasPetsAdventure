// Exercise both random arrival branches in a real renderer, using a temporary save.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

const port = 9900 + process.pid % 400;
const profile = mkdtempSync(join(tmpdir(), 'idle-arrival-smoke-'));
const out = resolve('artifacts/arrival-smoke');
mkdirSync(out, { recursive: true });
const child = spawn(electron, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'desktop/main.cjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '', ws;
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let target;
  for (let i = 0; i < 80; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url.includes('index.html')); } catch {}
    if (target) break;
    if (child.exitCode !== null) throw new Error(`Electron exited ${child.exitCode}`);
    await sleep(150);
  }
  if (!target) throw new Error('No renderer');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timeout = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 8000);
    pending.set(key, m => { clearTimeout(timeout); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const assert = (ok, message) => { if (!ok) throw new Error(message); console.log('✓ ' + message); };
  const waitFor = async expression => {
    for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error('Condition not met: ' + expression);
  };
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(200); };
  const loaded = () => waitFor("!!document.querySelector('.pet-hit canvas[data-pose]')");
  const stored = () => evaluate("JSON.parse(localStorage.getItem('idle-pet-adventure.demo.v1'))");
  await send('Runtime.enable'); await send('Page.enable'); await loaded();
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.arrivalRoll=0.1; Math.random=()=>window.arrivalRoll;
    window.realClock=Date.now.bind(Date); window.clockOffset=0;
    Date.now=()=>window.realClock()+window.clockOffset;
  ` });
  const initial = await stored();
  initial.completedTaskIds = Object.keys(JSON.parse(readFileSync('src/domain/catalog.bundled.json', 'utf8')).tasks);
  await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1',${JSON.stringify(JSON.stringify(initial))})`);
  await send('Page.reload'); await loaded();
  await click('.pet-hit'); await click('.pet-bubbles button[aria-label="行动"]');
  await click('.ap-pet-card'); await click('.ap-footer .ap-primary'); await click('.ap-footer .ap-primary');
  await click('.pickable .ap-map-node'); await click('.ap-footer .ap-primary'); await click('.ap-footer .ap-primary');
  const launched = await stored();
  await waitFor("document.querySelector('.pet-hit canvas').dataset.pose==='walk'");
  for (const [clip, roll] of [['arrive-a', .1], ['arrive-b', .9]]) {
    if (clip === 'arrive-b') {
      const fixture = structuredClone(launched);
      fixture.expeditions[0].startedAt = Date.now(); fixture.expeditions[0].arriveAt = Date.now() + 30_000;
      await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1',${JSON.stringify(JSON.stringify(fixture))})`);
      await send('Page.reload'); await loaded();
      await waitFor("document.querySelector('.pet-hit canvas').dataset.pose==='walk'");
    }
    await evaluate(`window.arrivalRoll=${roll}`);
    await evaluate(`(()=>{
      window.arrivalFrames=[]; window.arrivalImages={}; window.sampleArrival=true;
      const sample=()=>{
        const c=document.querySelector('.pet-hit canvas'),pose=c.dataset.pose,frame=Number(c.dataset.frame);
        const record={t:performance.now(),pose,frame};
        if((pose==='walk'&&frame===114)||(pose.startsWith('arrive-')&&(frame===0||frame===121))||pose==='standing'){
          const a=c.getContext('2d').getImageData(0,0,300,282).data;let left=300,right=-1,bottom=0,transparent=0;
          for(let y=0;y<282;y++)for(let x=0;x<300;x++){
            if(a[(y*300+x)*4+3]>60){bottom=Math.max(bottom,y);if(y>=155&&y<239){left=Math.min(left,x);right=Math.max(right,x);}}
            else transparent++;
          }
          const r=c.getBoundingClientRect();Object.assign(record,{cx:(left+right)/2,bottom,transparent,screenX:screenX+r.x,screenY:screenY+r.y});
          window.arrivalImages[pose+'-'+frame]=c.toDataURL('image/png');
        }
        window.arrivalFrames.push(record);if(window.sampleArrival)requestAnimationFrame(sample);
      };sample();
      window.clockOffset+=60_000;
    })()`);
    await waitFor(`document.querySelector('.pet-hit canvas').dataset.pose==='${clip}'`);
    await click('.pet-hit');
    assert(await evaluate(`document.querySelector('.pet-hit canvas').dataset.pose==='${clip}'`), `${clip}: menu interaction preserves arrival`);
    await waitFor("document.querySelector('.pet-hit canvas').dataset.pose==='standing'");
    const frames = await evaluate('(window.sampleArrival=false,window.arrivalFrames)');
    const firstIndex = frames.findIndex(f => f.pose === clip);
    const head = frames[firstIndex], tail = frames.slice(0, firstIndex).findLast(f => f.pose === 'walk');
    const end = frames.findLast(f => f.pose === clip), standing = frames.find(f => f.pose === 'standing');
    assert(head?.frame === 0 && tail?.frame === 114, `${clip}: walk tail connects to arrival frame zero`);
    assert(end?.frame === 121 && standing.t - head.t >= 5000, `${clip}: all 122 frames finish before standing`);
    for (const [a, b] of [[tail, head], [end, standing]]) {
      assert(Math.abs(a.cx-b.cx)<=1 && Math.abs(a.bottom-b.bottom)<=1 && Math.abs(a.screenX-b.screenX)<=1 && Math.abs(a.screenY-b.screenY)<=1,
        `${clip}: seam anchors and window position agree within 1px: ${JSON.stringify({a,b})}`);
      assert(a.transparent>20000 && b.transparent>20000, `${clip}: transparent background survives runtime encoding`);
    }
    assert(!frames.some(f => f.pose.startsWith('sleep')), `${clip}: travel does not trigger immediate sleep`);
    writeFileSync(join(out, clip+'-frames.json'), JSON.stringify(frames, null, 2));
    const images = await evaluate('window.arrivalImages');
    for (const [name, data] of Object.entries(images)) writeFileSync(join(out, clip+'-'+name+'.png'), Buffer.from(data.split(',')[1], 'base64'));
  }
  assert(errors.length === 0, 'No renderer exceptions');
  writeFileSync(join(out, 'result.json'), JSON.stringify({ passed: true, profile, errors }, null, 2));
} catch (error) { console.error(error); console.error(logs); process.exitCode=1; }
finally { ws?.close(); child.kill(); }
