// Real Electron integration checks in an isolated profile; never touch the player's save.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

const port = 9500 + process.pid % 400;
const profile = mkdtempSync(join(tmpdir(), 'idle-action-panel-smoke-'));
const out = resolve('artifacts/adventure-prototype-smoke');
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
  const stored=()=>evaluate(`JSON.parse(localStorage.getItem('idle-pet-adventure.demo.v1'))`);
  const textButton=async text=>{
    const selector=await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('.adventure-panel button')).find(b=>b.textContent===${JSON.stringify(text)}&&!b.disabled);if(!b)throw Error('Missing button '+${JSON.stringify(text)});b.dataset.smoke='target';return '[data-smoke="target"]'})()`);
    await click(selector);await evaluate(`document.querySelector('[data-smoke="target"]')?.removeAttribute('data-smoke')`);
  };
  const seed=async (fixture, resetUI=true)=>{
    await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1',${JSON.stringify(JSON.stringify(fixture))});${resetUI ? "Object.keys(localStorage).filter(k=>k.startsWith('idle-pet.ui.v1.')).forEach(k=>localStorage.removeItem(k));" : ''}`);
    await send('Page.reload');await loaded();await open();
  };
  // Capture the user-provided prototype itself, not a recreated mockup.
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  await send('Page.navigate',{url:'file://'+resolve('prototypes/expedition-panel.html')});
  await waitFor(`!!document.querySelector('#mount .panel')`);
  const proto=async(name,expression)=>{await evaluate(expression+';render();document.querySelector("#mount").scrollIntoView({block:"center"})');await sleep(400);const clip=await evaluate(`(()=>{const r=document.querySelector('#mount .panel').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()`);const cap=await send('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true});writeFileSync(join(out,name+'.png'),Buffer.from(cap.data,'base64'));};
  await proto('prototype-map','S.pet="gugugaga";S.stage="map"');
  await proto('prototype-entry','S.stage="start"');
  await proto('prototype-loadout','S.stage="bag"');
  await proto('prototype-event','S.stage="event";S.evtStep="choose"');
  await proto('prototype-dice','S.evtStep="judge";S.evtChoice=curEvent().choices[0].id');

  await send('Page.navigate',{url:target.url});
  await loaded();const initial=await stored(),fixture=structuredClone(initial),petId=Object.keys(initial.pets)[0];
  fixture.inventory={paper:3,'cloth-strip':5,'hemp-rope':2};fixture.unlockedMapIds=['map-1','map-2'];
  fixture.pets[petId].baseStats={fitness:12,perception:12,technique:12};
  const frameCheck=async()=>assert(await evaluate(`(()=>{const p=document.querySelector('.adventure-panel'),body=p.querySelector('.ap-body'),r=p.getBoundingClientRect();return Math.round(r.width)===810&&Math.round(r.height)===748&&body.clientHeight===640})()`),'shared 812 × 750 frame and flexible 640px content stage');
  await seed(fixture);await click('.ap-pet-card');await shot('01-team');
  await textButton('选择探险地图');await frameCheck();await shot('02-map');
  assert(await evaluate(`(()=>{const m=document.querySelector('.ap-map'),r=m.getBoundingClientRect();return !document.querySelector('.ap-map-tabs')&&document.querySelectorAll('.ap-carousel-arrow').length===2&&Math.abs(r.width/r.height-16/9)<.001&&document.querySelectorAll('.ap-map-node').length===4})()`),'map carousel arrows and unstretched 16:9 authored map');
  await click('[aria-label="下一张地图"]');await shot('03-map-two');
  assert(await evaluate(`document.querySelectorAll('.ap-map-node').length===8`),'config-driven map two keeps all eight nodes');
  await click('[aria-label="上一张地图"]');await textButton('选择起始点');await shot('04-entry');
  assert(await evaluate(`document.querySelector('.ap-footer .ap-primary').disabled`),'entry must be explicitly picked on the map');
  await click('.pickable .ap-map-node');await textButton('行前整备');await click('.ap-transfer section:first-child .ap-item');await shot('05-loadout');await frameCheck();
  assert((await stored()).inventory.paper===3,'loadout is an uncommitted draft');
  await send('Page.reload');await loaded();await open();
  assert(await evaluate(`document.querySelector('.ap-bag-col .ap-item').getAttribute('aria-label')==='纸张 ×1'`),'loadout survives reload');
  await textButton('开始探索');await shot('06-travel');await frameCheck();
  let running=await stored();running.expeditions[0].arriveAt=0;
  await seed(running,false);await waitFor(`!!document.querySelector('.ap-route-choices')`);await shot('07-routes');
  await click('.ap-route-choices button:first-child');running=await stored();running.expeditions[0].arriveAt=0;
  await seed(running,false);await waitFor(`!!document.querySelector('.ap-chest')`);await shot('08-chest-closed');
  let arrived=await stored(),ex=arrived.expeditions[0];
  assert(ex.pendingLoot&&JSON.stringify(ex.cargo)==='{"paper":1}','arrival creates pending loot without automatically adding it to cargo');
  const seedBefore=ex.currentSeed,pendingBefore=JSON.stringify(ex.pendingLoot);
  await click('.ap-chest');await sleep(1400);await shot('09-chest-open');
  assert((await stored()).expeditions[0].currentSeed===seedBefore,'opening chest never rerolls loot');
  await send('Page.reload');await loaded();await open();
  assert(JSON.stringify((await stored()).expeditions[0].pendingLoot)===pendingBefore,'unclaimed loot and opened chest survive restart');
  await textButton('全部拾取');await shot('10-picked');
  assert(Object.keys((await stored()).expeditions[0].pendingLoot).length===0,'pick all transfers available loot');
  await click('.ap-footer .ap-primary');arrived=await stored();
  const openState=async state=>{await seed(state);await click('.ap-team-list button:first-child');};
  let eventState=structuredClone(arrived);ex=eventState.expeditions[0];ex.phase='awaiting-event';ex.currentEventId='event-unclaimed-travel-bag';ex.cargo={};ex.arrivalLoot={};delete ex.pendingLoot;delete ex.lastResolution;
  eventState.pets[petId].secondaryStats.lore=1;
  await openState(eventState);await shot('11-event-options');await frameCheck();
  assert(await evaluate(`document.querySelectorAll('.ap-event-option').length===3&&document.querySelectorAll('.ap-event-option[aria-disabled=true]').length===1`),'one primary, one gated secondary, one leave option');
  await click('.ap-event-option:first-child');await shot('12-dice-ready');await frameCheck();
  assert(await evaluate(`document.querySelectorAll('.ap-outcome-scale>span').length===6`),'full intel reveals six outcome segments');
  await evaluate(`document.querySelector('.ap-dice-button').click()`);
  await sleep(120);
  const animationA=await evaluate(`[...document.querySelectorAll('.ap-die-lift')].map(e=>e.style.transform)`);
  await shot('13-dice-rolling');await sleep(200);
  const animationB=await evaluate(`[...document.querySelectorAll('.ap-die-lift')].map(e=>e.style.transform)`);
  assert(JSON.stringify(animationA)!==JSON.stringify(animationB),'dice actually hop and rotate through animation frames');
  const committed=(await stored()).expeditions[0].lastResolution;
  assert(committed.check.type==='primary','real result is persisted before animation finishes');
  await sleep(1500);await shot('14-dice-landed');
  assert(await evaluate(`document.querySelector('.ap-verdict').classList.contains('show')&&document.querySelectorAll('.ap-die img.on').length===1`),'landing reveals the stored face and verdict');
  await textButton('查看结果');await shot('15-event-result');
  await send('Page.reload');await loaded();await open();
  assert(JSON.stringify((await stored()).expeditions[0].lastResolution)===JSON.stringify(committed),'result reload never rerolls or grants rewards twice');
  await click('.ap-footer .ap-primary');
  const lucky=structuredClone(eventState);lucky.pets[petId].growthTagIds=['tag-lucky'];
  await openState(lucky);await click('.ap-event-option:first-child');await click('.ap-dice-button');await sleep(1600);await shot('16-lucky');
  const lc=(await stored()).expeditions[0].lastResolution.check;
  assert(lc.rolls.length===2&&await evaluate(`document.querySelectorAll('.ap-die img.on').length===2`),'lucky displays two real dice and selects the higher value');
  const secondary=structuredClone(eventState);secondary.pets[petId].secondaryStats.lore=5;
  await openState(secondary);await click('.ap-event-option:nth-child(2)');await sleep(800);await shot('17-secondary');
  assert((await stored()).expeditions[0].lastResolution.outcome==='extra-success'&&await evaluate(`!document.querySelector('.ap-dice')&&!!document.querySelector('.ap-secondary-pointer')`),'secondary automatically slides to deterministic great success without dice');
  for(const [perception,tier] of [[0,1],[2,2]]){
    const low=structuredClone(eventState);low.pets[petId].baseStats.perception=perception;
    await openState(low);await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await evaluate(`document.querySelector('.ap-event-option[aria-disabled=true]').focus()`);await waitFor(`document.querySelector('.ap-event-tip')?.textContent.includes('学识')`);
    const tip=await evaluate(`document.querySelector('.ap-event-tip')?.textContent||''`);
    assert(tier===1?tip.includes('学识不足')&&!tip.includes('达到'):tip.includes('需要学识达到 3'),'secondary tooltip follows intel tier '+tier);
    await click('.ap-event-option:first-child');
    assert(await evaluate(`document.querySelectorAll('.ap-outcome-scale>span').length===0&&!document.querySelector('.ap-judge').textContent.includes('%')`),'low intel does not expose exact dice distribution');
  }
  await openState(eventState);await click('.ap-event-option:last-child');await shot('18-leave');
  assert((await stored()).expeditions[0].lastResolution.outcome==='leave','leave resolves directly without a confirmation dice stage');
  const extraction=structuredClone(arrived);ex=extraction.expeditions[0];ex.phase='extraction';ex.currentNodeId='m1-goal-1';delete ex.lastResolution;delete ex.pendingLoot;ex.cargo={paper:3,'cloth-strip':2};ex.initialCargo={paper:1};extraction.inventory={paper:8};extraction.warehouseSlots=40;
  await openState(extraction);await shot('19-extraction');await frameCheck();
  await click('.ap-transfer section:first-child .ap-item');
  assert((await stored()).inventory.paper===8,'extraction transfer does not mutate actual warehouse');
  await send('Page.reload');await loaded();await open();
  assert(await evaluate(`!!document.querySelector('.ap-item.fresh')`),'extraction draft survives reload');
  await textButton('确认撤离');await shot('20-sale-confirm');await textButton('返回整理');await textButton('全部入库');await textButton('确认撤离');await shot('21-report');
  assert((await stored()).inventory.paper===11&&(await stored()).inventory['ancient-coin']===1,'extraction commits selected inventory and first reward once');
  await openState(extraction);await click('.ap-transfer section:first-child .ap-item');await textButton('确认撤离');
  const changed=await stored();changed.inventory.paper+=1;await seed(changed,false);
  assert(await evaluate(`!document.querySelector('[role="alertdialog"]')&&document.querySelector('.ap-warning').textContent.includes('变化')`),'changed warehouse invalidates an open extraction confirmation');
  const unsellable=structuredClone(extraction);unsellable.expeditions[0].cargo={'filled-dice':1};unsellable.expeditions[0].initialCargo={};
  const customCatalog=JSON.parse(readFileSync('src/domain/catalog.bundled.json','utf8'));
  customCatalog.items['filled-dice'].sellable=false;delete customCatalog.items['filled-dice'].sellValue;
  await evaluate(`localStorage.setItem('idle-pet-adventure.catalog.published.v6',${JSON.stringify(JSON.stringify(customCatalog))})`);
  await openState(unsellable);
  assert(await evaluate(`!!document.querySelector('.ap-unsellable')&&document.querySelector('.ap-footer .ap-primary').disabled`),'unsellable cargo cannot be implicitly sold');
  await textButton('标记丢弃');await textButton('确认撤离');
  assert(await evaluate(`document.querySelector('.ap-dialog').textContent.includes('丢弃')`),'discarding unsellable cargo needs final confirmation');
  await evaluate(`localStorage.removeItem('idle-pet-adventure.catalog.published.v6')`);
  const crowded=structuredClone(arrived);delete crowded.expeditions[0].pendingLoot;delete crowded.expeditions[0].lastResolution;crowded.expeditions[0].phase='awaiting-route';crowded.expeditions[0].cargo={'car-tire':21};crowded.expeditions[0].initialCargo={};
  await openState(crowded);
  assert(await evaluate(`Array.from(document.querySelectorAll('.ap-route-choices button')).every(b=>b.disabled)&&document.querySelector('.ap-route-choices').textContent.includes('背包超格')`),'over-slot cargo blocks routes without silently deleting rewards');
  await click('[aria-label="查看探险背包"]');await click('.ap-bag-dialog .ap-item');await textButton('丢 1 件');
  await send('Page.reload');await loaded();await open();
  assert(await evaluate(`!!document.querySelector('[aria-label="确认丢弃"]')`),'cargo discard confirmation survives reload without committing');
  await textButton('确认丢弃');await click('[aria-label="关闭背包"]');
  assert(await evaluate(`!!document.querySelector('.ap-route-choices button:not(:disabled)')`),'confirmed cargo cleanup re-enables routes');
  // Use a real recorded choice but remove its optional dice snapshot, as pre-snapshot saves did.
  await openState(eventState);await click('.ap-event-option:first-child');await click('.ap-dice-button');await sleep(1600);
  const oldResult=await stored();delete oldResult.expeditions[0].lastResolution.check;await openState(oldResult);
  assert(await evaluate(`!!document.querySelector('.ap-result')&&!document.querySelector('.ap-dice-button')`),'legacy results without dice snapshots never invent or reroll dice');
  const defeat=structuredClone(eventState);defeat.pets[petId].injury='injured';defeat.pets[petId].baseStats.fitness=0;defeat.expeditions[0].cargo={'car-tire':30};defeat.expeditions[0].currentEventId='event-roadside-bandits';
  await openState(defeat);await click('.ap-event-option:first-child');await click('.ap-dice-button');await sleep(1600);await shot('22-defeat-dice');
  assert((await stored()).expeditions.length===0&&await evaluate(`!!document.querySelector('.ap-verdict.show')`),'fatal result is saved while the final dice animation still completes');
  await textButton('查看结果');await click('.ap-footer .ap-primary');await shot('23-defeat-report');
  const abandon=structuredClone(arrived);ex=abandon.expeditions[0];ex.pendingLoot={paper:3};ex.arrivalLoot={paper:3};ex.cargo={};delete ex.lastResolution;
  await openState(abandon);await click('.ap-chest');await sleep(1400);await click('.ap-loot-card');
  assert((await stored()).expeditions[0].cargo.paper===1&&(await stored()).expeditions[0].pendingLoot.paper===2,'left click picks exactly one item');
  await evaluate(`document.querySelector('.ap-loot-card').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);await sleep(500);
  assert((await stored()).expeditions[0].cargo.paper===3&&Object.keys((await stored()).expeditions[0].pendingLoot).length===0,'right click picks the remaining stack without duplicating loot');
  await openState(abandon);await click('.ap-chest');await sleep(1400);await click('.ap-footer .ap-primary');
  assert(await evaluate(`!!document.querySelector('[aria-label="放弃未拾取战利品"]')`),'leaving unclaimed loot requires confirmation');
  await textButton('回去拾取');assert((await stored()).expeditions[0].pendingLoot.paper===3,'cancel preserves unclaimed loot');
  await click('.ap-footer .ap-primary');await textButton('确认丢弃并继续');
  assert(!(await stored()).expeditions[0].pendingLoot&&Object.keys((await stored()).expeditions[0].cargo).length===0,'confirmed abandonment never grants discarded items');
  const team=structuredClone(initial);for(let i=2;i<=4;i++)team.pets['test-'+i]={...structuredClone(team.pets[petId]),id:'test-'+i,name:'测试伙伴 '+i};
  await seed(team);for(let i=1;i<=3;i++)await click('.ap-pet-card:nth-child('+i+')');
  assert(await evaluate(`document.querySelector('.ap-pet-card:nth-child(4)').disabled`),'three-pet team limit is preserved');
  await shot('24-team');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await shot('25-dark');
  assert(errors.length===0,'no renderer exceptions throughout adventure flow');
  writeFileSync(join(out,'result.json'),JSON.stringify({passed:true,profile,errors},null,2));console.log('Screenshots: '+out);
} catch(error) { console.error(error);console.error(logs);process.exitCode=1; }
finally { ws?.close();child.kill(); }
