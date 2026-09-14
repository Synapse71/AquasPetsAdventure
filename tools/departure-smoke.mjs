// Real Electron integration checks in an isolated profile; never touch the player's save.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

const port = 9500 + process.pid % 400;
const profile = mkdtempSync(join(tmpdir(), 'idle-departure-smoke-'));
const out = resolve('artifacts/departure-smoke');
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

  await loaded();
  const standingSource=await evaluate(`(async()=>{const im=new Image();im.src=new URL('pet-sprites/standing.png',location.href).href;await im.decode();return {width:im.naturalWidth,height:im.naturalHeight}})()`);
  assert(standingSource.width===300&&standingSource.height===282,'standing frame matches native animation resolution instead of upscaling a thumbnail');
  await shot('00-standing-native-resolution');
  const stored=()=>evaluate("JSON.parse(localStorage.getItem('idle-pet-adventure.demo.v1'))");
  const folded=()=>evaluate("!document.querySelector('.pet-travel')&&!document.querySelector('.pet-bubbles.open')");
  assert(await folded(),'startup keeps menu and travel overlay folded');
  const initial=await stored(),fixture=structuredClone(initial),petId=Object.keys(initial.pets)[0];
  fixture.completedTaskIds=Object.keys(JSON.parse(readFileSync('src/domain/catalog.bundled.json','utf8')).tasks);
  await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1',${JSON.stringify(JSON.stringify(fixture))})`);
  await send('Page.reload');await loaded();await open();
  await click('.ap-pet-card');
  await click('.ap-footer .ap-primary');await click('.ap-footer .ap-primary');
  await click('.pickable .ap-map-node');await click('.ap-footer .ap-primary');
  await evaluate(`(()=>{
    window.departureFrames=[];window.sampleDeparture=true;window.seamImages={};
    const sample=()=>{const c=document.querySelector('.pet-hit canvas'),frame=Number(c.dataset.frame),pose=c.dataset.pose;
      const record={t:performance.now(),pose,frame,offsetX:Number(c.dataset.offsetX)};
      if((pose==='start-explore'&&frame===120)||(pose==='walk'&&frame===0)){
        const a=c.getContext('2d').getImageData(0,0,300,282).data;let left=300,right=-1,bottom=0;
        for(let y=0;y<282;y++)for(let x=0;x<300;x++)if(a[(y*300+x)*4+3]>60){bottom=Math.max(bottom,y);if(y>=155&&y<239){left=Math.min(left,x);right=Math.max(right,x);}}
        const r=c.getBoundingClientRect();Object.assign(record,{cx:(left+right)/2,bottom,screenX:screenX+r.x,screenY:screenY+r.y});
        if(!window.seamImages[pose])window.seamImages[pose]=c.toDataURL('image/png');
      }
      window.departureFrames.push(record);if(window.sampleDeparture)requestAnimationFrame(sample);};sample();
  })()`);
  await click('.ap-footer .ap-primary');
  const launched=await stored();
  assert(launched.expeditions[0].arriveAt-launched.expeditions[0].startedAt===30000,'real engine schedules the first leg for 30 seconds');
  await waitFor("document.querySelector('.pet-hit canvas').dataset.pose==='start-explore'");
  assert(await folded(),'dispatch does not force a persistent travel overlay');
  await shot('01-departure');
  await evaluate("window.dispatchEvent(new Event('blur'))");await click('.pet-hit');
  assert(await evaluate("!!document.querySelector('.pet-travel')&&!!document.querySelector('.pet-bubbles.open')"),'clicking the traveling pet reveals progress together with menu');
  assert(await evaluate("document.querySelector('.pet-travel span').textContent==='前往起点'"),'the initial leg uses a preparation label instead of a destination name');
  assert(await evaluate("document.querySelector('.pet-hit canvas').dataset.pose==='start-explore'"),'menu interaction does not cut short departure');
  await shot('02-departure-menu');
  await click('.pet-hit');assert(await folded(),'clicking again folds both menu and progress');
  await waitFor("document.querySelector('.pet-hit canvas').dataset.pose==='walk'");
  const frames=await evaluate("(window.sampleDeparture=false,window.departureFrames)");
  const start=frames.find(f=>f.pose==='start-explore'),walk=frames.find(f=>start&&f.t>start.t&&f.pose==='walk'),endFrames=frames.filter(f=>f.pose==='start-explore');
  assert(start&&walk&&walk.t-start.t>=5000&&Math.max(...endFrames.map(f=>f.frame))===120,'departure displays its last frame and lasts the full 121-frame clip before walk');
  writeFileSync(join(out,'departure-frames.json'),JSON.stringify(frames,null,2));
  const tail=frames.findLast(f=>f.pose==='start-explore'&&f.frame===120),head=frames.find(f=>f.pose==='walk'&&f.frame===0);
  assert(tail&&head&&Math.abs(tail.cx-head.cx)<=1&&Math.abs(tail.bottom-head.bottom)<=1&&Math.abs(tail.screenX-head.screenX)<=1&&Math.abs(tail.screenY-head.screenY)<=1,'departure tail and walk head keep the same torso anchor, foot baseline and window position: '+JSON.stringify({tail,head}));
  const seamImages=await evaluate('window.seamImages');
  for(const [pose,data] of Object.entries(seamImages))writeFileSync(join(out,'seam-'+pose+'.png'),Buffer.from(data.split(',')[1],'base64'));
  const clipping=await evaluate(`(async()=>{
    const im=new Image();im.src=new URL('pet-sprites/start-explore.webp',location.href).href;await im.decode();
    const c=document.createElement('canvas');c.width=300;c.height=282;const ctx=c.getContext('2d'),bad=[];
    for(const f of window.departureFrames.filter(f=>f.pose==='start-explore'&&f.offsetX>0)){
      ctx.clearRect(0,0,300,282);ctx.drawImage(im,f.frame%10*300,Math.floor(f.frame/10)*282,300,282,0,0,300,282);
      const a=ctx.getImageData(0,0,300,282).data;let right=0;
      for(let y=0;y<282;y++)for(let x=0;x<300;x++)if(a[(y*300+x)*4+3]>20)right=Math.max(right,x);
      if(right+f.offsetX>=300)bad.push({frame:f.frame,right,offsetX:f.offsetX});
    }
    return bad;
  })()`);
  assert(clipping.length===0,'root correction does not push visible flag or body pixels outside the canvas: '+JSON.stringify(clipping));
  await shot('03-walk-folded');
  await click('.pet-hit');await click('.pet-bubbles button[aria-label="行动"]');
  assert(await folded(),'opening a panel folds the travel overlay with the menu');
  await send('Page.reload');await loaded();
  await waitFor("document.querySelector('.pet-hit canvas').dataset.pose==='walk'");
  assert(await folded(),'restarting mid-trip resumes walk with no overlay and no replayed departure');
  await click('.pet-hit');await evaluate("window.dispatchEvent(new Event('blur'))");await sleep(100);
  assert(await folded(),'blur folds both menu and progress');
  const arrived=await stored();arrived.expeditions[0].arriveAt=0;
  await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1',${JSON.stringify(JSON.stringify(arrived))})`);
  await send('Page.reload');await loaded();await open();await waitFor("!!document.querySelector('.ap-route-choices')");
  await evaluate(`(()=>{
    window.departureFrames=[];window.sampleDeparture=true;
    const sample=()=>{const c=document.querySelector('.pet-hit canvas');window.departureFrames.push({t:performance.now(),pose:c.dataset.pose,frame:Number(c.dataset.frame)});if(window.sampleDeparture)requestAnimationFrame(sample);};sample();
  })()`);
  const routeLabel=await evaluate("document.querySelector('.ap-route-choices button:first-child strong').textContent");
  await click('.ap-route-choices button:first-child');
  await waitFor("document.querySelector('.pet-hit canvas').dataset.pose==='start-explore'");
  assert(await evaluate("document.querySelector('.pet-hit canvas').dataset.pose==='start-explore'"),'choosing a new destination plays departure again after any ongoing arrival finishes');
  await shot('04-route-departure');
  await waitFor("document.querySelector('.pet-hit canvas').dataset.pose==='walk'");
  const routeFrames=await evaluate("(window.sampleDeparture=false,window.departureFrames)");
  const routeStart=routeFrames.find(f=>f.pose==='start-explore'),routeWalk=routeFrames.find(f=>routeStart&&f.t>routeStart.t&&f.pose==='walk');
  assert(routeStart&&routeWalk&&routeWalk.t-routeStart.t>=5000&&Math.max(...routeFrames.filter(f=>f.pose==='start-explore').map(f=>f.frame))===120,'later route departure also plays through its final frame');
  writeFileSync(join(out,'route-departure-frames.json'),JSON.stringify(routeFrames,null,2));
  await send('Page.reload');await loaded();
  await waitFor("document.querySelector('.pet-hit canvas').dataset.pose==='walk'");
  assert(await folded(),'restoring a later route resumes walking without replaying its departure');
  await click('.pet-hit');
  assert(await evaluate(`document.querySelector('.pet-travel span').textContent===${JSON.stringify(routeLabel)}`),'travel overlay displays the selected route name, not the destination node');
  await click('.pet-hit');
  // Advance the isolated renderer clock through a long trip, then keep it fixed
  // to check the exact inactivity boundary without waiting three real minutes.
  await evaluate("window.sleepTestClock=Date.now()+7200000;Date.now=()=>window.sleepTestClock");
  await waitFor("JSON.parse(localStorage.getItem('idle-pet-adventure.demo.v1')).expeditions[0].phase!=='traveling'");
  // The arrival transition now owns the pose. Drive the frozen test clock
  // through the remaining walk cycle and the complete one-shot first.
  for (let i=0;i<150;i++) {
    if (await evaluate("document.querySelector('.pet-hit canvas').dataset.pose==='standing'")) break;
    await evaluate("window.sleepTestClock+=100"); await sleep(30);
  }
  await waitFor("document.querySelector('.pet-hit canvas').dataset.pose==='standing'");
  assert(await evaluate("!!document.querySelector('.pet-bulb')"),'arrival remains awake while pending work lights the bulb');
  await evaluate("window.sleepBoundaryBase=window.sleepTestClock");
  // Reset with a real interaction so this assertion has an exact known origin.
  await click('.pet-hit');
  await evaluate("window.sleepTestClock=window.sleepBoundaryBase+179999");await sleep(150);
  assert(await evaluate("!document.querySelector('.pet-hit canvas').dataset.pose.startsWith('sleep')"),'two hours of travel do not consume the post-arrival inactivity window');
  await evaluate("window.sleepTestClock+=1");
  await waitFor("document.querySelector('.pet-hit canvas').dataset.pose==='sleep-start'");
  assert(await evaluate("!!document.querySelector('.pet-bulb')"),'sleep starts only after three resting minutes, without hiding pending work');
  assert(errors.length===0,'no renderer exceptions');
  writeFileSync(join(out,'result.json'),JSON.stringify({passed:true,profile,errors},null,2));
  console.log('Screenshots: '+out);
} catch(error) { console.error(error);console.error(logs);process.exitCode=1; }
finally { ws?.close();child.kill(); }
