// Real Electron integration checks in an isolated profile; never touch the player's save.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

const port = 9500 + process.pid % 400;
const profile = mkdtempSync(join(tmpdir(), 'idle-action-panel-smoke-'));
const out = resolve('artifacts/action-panel-smoke');
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
  await loaded();const initial=await stored(),fixture=structuredClone(initial),petId=Object.keys(initial.pets)[0];
  fixture.inventory={'paper':3,'cloth-strip':5,'hemp-rope':2};fixture.unlockedMapIds=['map-1','map-2'];
  fixture.pets[petId].baseStats={fitness:12,perception:12,technique:12};
  await seed(fixture);
  assert(await evaluate(`(()=>{const e=document.querySelector('.window-adventure'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width===812&&r.height===750&&s.boxShadow==='none'&&s.borderTopColor==='rgb(174, 178, 186)'})()`),'shared 812x750 action frame, gray border and no shadow');
  assert(await evaluate(`!document.querySelector('.ap-phase') && !document.querySelector('.ap-header').textContent.includes('选择伙伴') && !!document.querySelector('.ap-steps')`),'header has no phase name while preparation step navigation remains');
  await click('.ap-pet-card');await shot('01-team');
  await textButton('下一步');await shot('02-map');
  assert(await evaluate(`document.querySelector('.ap-map').classList.contains('illustrated')&&document.querySelectorAll('.ap-map-node').length===4`),'map one uses authored artwork with real nodes');
  await click('.ap-map-tabs button:nth-child(2)');await shot('03-map-two');
  assert(await evaluate(`!document.querySelector('.ap-map').classList.contains('illustrated')&&document.querySelectorAll('.ap-map-node').length===8`),'map two uses configuration-driven graph fallback');
  await click('.ap-map-tabs button:first-child');await textButton('下一步');await shot('04-entry');
  await textButton('下一步');await click('.ap-transfer section:first-child .ap-item');
  assert(JSON.stringify((await stored()).inventory)===JSON.stringify(fixture.inventory),'preparation transfer remains an uncommitted draft');
  await shot('05-loadout');await send('Page.reload');await loaded();await open();
  assert(await evaluate(`document.querySelector('.ap-transfer section:nth-child(2) .ap-item')!==null`),'loadout draft survives reload');
  await textButton('出发');
  let running=await stored(),e=running.expeditions[0];
  assert(e.initialCargo.paper===1&&running.inventory.paper===2,'dispatch deducts exactly the selected cargo');
  await shot('06-travel');
  running.expeditions[0].arriveAt=0;
  await seed(running,false);await waitFor(`!!document.querySelector('.ap-choices')`);await shot('07-routes');
  assert(!(await evaluate(`document.querySelector('.ap-footer').textContent`)).includes('在此撤离'),'start node cannot extract');
  await click('.ap-choices button:first-child');running=await stored();
  assert(running.expeditions[0].phase==='traveling','route choice starts real engine travel');
  running.expeditions[0].arriveAt=0;await seed(running,false);await waitFor(`!!document.querySelector('.ap-choices')`);
  const arrival=await stored();await shot('08-arrival');
  assert(arrival.expeditions[0].completedNodeCount===1,'ordinary arrival completes one actual node');
  // Inject only timing/phase fixtures into the isolated profile, never production data.
  let eventState=structuredClone(arrival);
  eventState.expeditions[0].phase='awaiting-event';eventState.expeditions[0].currentEventId='event-unclaimed-travel-bag';
  eventState.expeditions[0].cargo={};eventState.expeditions[0].arrivalLoot={};
  eventState.pets[petId].secondaryStats.lore=1;
  await seed(eventState,false);await shot('09-event-choices');
  assert(await evaluate(`document.querySelectorAll('.ap-choice').length===3&&document.querySelectorAll('.ap-choice[aria-disabled="true"]').length===1`),'event has one primary, one gated secondary and a leave choice');
  await click('.ap-choice:first-child');await shot('10-judge');
  assert(await evaluate(`document.querySelectorAll('.ap-outcome-scale>span').length===6`),'full intel shows exact D6 outcomes before rolling');
  await textButton('掷骰');await sleep(1500);await shot('11-event-result');
  const resolved=await stored(),check=resolved.expeditions[0].lastResolution.check;
  assert(check.type==='primary'&&check.rolls.length===1,'dice display reads the committed engine roll');
  await send('Page.reload');await loaded();await open();
  assert(JSON.stringify((await stored()).expeditions[0].lastResolution)===JSON.stringify(resolved.expeditions[0].lastResolution),'reopening never rerolls or duplicates an event reward');
  await textButton('继续');
  let extraction=await stored();extraction.expeditions[0].phase='extraction';extraction.expeditions[0].currentNodeId='m1-goal-1';extraction.expeditions[0].lastResolution=undefined;extraction.expeditions[0].cargo={paper:3,'cloth-strip':2};extraction.inventory={paper:8};extraction.expeditions[0].initialCargo={paper:1};extraction.warehouseSlots=40;
  await seed(extraction,false);await shot('12-extraction');
  await click('.ap-transfer section:first-child .ap-item');
  assert(JSON.stringify((await stored()).inventory)===JSON.stringify(extraction.inventory),'extraction transfer does not touch warehouse before confirmation');
  await send('Page.reload');await loaded();await open();
  assert(await evaluate(`document.querySelector('.ap-transfer section:nth-child(2) .movable')!==null`),'extraction keep draft survives reload');
  for(let i=0;i<3;i++) await click('.ap-transfer section:nth-child(2) .ap-item');
  assert(await evaluate(`document.querySelector('.ap-transfer section:nth-child(2) .ap-item').textContent==='8'`),'repeated taking back cannot remove eight old warehouse items');
  await textButton('确认撤离');await shot('13-sale-confirm');
  assert(await evaluate(`!!document.querySelector('[role="alertdialog"]')`),'leftover sale requires explicit itemized confirmation');
  await textButton('返回整理');
  assert((await stored()).currency===extraction.currency,'cancelled sale does not grant currency');
  await textButton('全部入库');await textButton('确认撤离');await shot('14-report');
  const done=await stored();
  assert(done.expeditions.length===0&&done.inventory.paper===11&&done.inventory['cloth-strip']===2&&done.inventory['ancient-coin']===1,'successful extraction keeps old stock, adds selected loot and first reward once');
  await send('Page.reload');await loaded();await open();
  assert(JSON.stringify((await stored()).inventory)===JSON.stringify(done.inventory),'report reopening cannot replay inventory rewards');
  await click('.ap-tabs button:nth-child(2)');await shot('15-tasks');
  assert(await evaluate(`!!document.querySelector('.ap-task-layout')&&!document.querySelector('.ap-task-layout').textContent.includes('XP')`),'tasks display actual requirements and no XP reward');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await shot('16-dark-tasks');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  const openEvent=async state=>{await seed(state);await click('.ap-team-list button:first-child');};
  for(const [perception,tier] of [[0,1],[2,2]]) {
    const low=structuredClone(eventState);low.pets[petId].baseStats.perception=perception;
    await openEvent(low);
    const gate=await evaluate(`document.querySelector('.ap-choice[aria-disabled="true"]').textContent`);
    assert(tier===1?gate.includes('学识不足')&&!gate.includes('达到'):gate.includes('需要学识达到 3'),'secondary gate respects intel tier '+tier);
    await click('.ap-choice:first-child');
    assert(await evaluate(`!document.querySelector('.ap-outcome-scale')&&!document.querySelector('.ap-judge').textContent.includes('%')`),'lower intel does not leak exact dice outcomes or percentages');
  }
  const lucky=structuredClone(eventState);lucky.pets[petId].growthTagIds=['tag-lucky'];
  await openEvent(lucky);await click('.ap-choice:first-child');
  assert(await evaluate(`document.querySelectorAll('.ap-dice-ready').length===2`),'lucky preflight explicitly shows two dice');
  await textButton('掷骰');await sleep(1400);await shot('17-lucky');
  assert((await stored()).expeditions[0].lastResolution.check.rolls.length===2,'lucky commits two real rolls');
  const secondary=structuredClone(eventState);secondary.pets[petId].secondaryStats.lore=5;
  await openEvent(secondary);await click('.ap-choice:nth-child(2)');
  assert(await evaluate(`!document.querySelector('.ap-dice-ready')&&document.querySelector('.ap-judge').textContent.includes('必定成功')`),'secondary option has no dice');
  await textButton('开始判定');await sleep(1400);await shot('18-secondary');
  assert((await stored()).expeditions[0].lastResolution.outcome==='extra-success','secondary threshold resolves deterministically to great success');
  await openEvent(eventState);await click('.ap-choice:last-child');await textButton('默默离开');
  assert((await stored()).expeditions[0].lastResolution.outcome==='leave','leave resolves safely without rolling');
  const defeat=structuredClone(eventState);defeat.pets[petId].injury='injured';defeat.pets[petId].baseStats.fitness=0;defeat.expeditions[0].cargo={'car-tire':30};defeat.expeditions[0].currentEventId='event-roadside-bandits';
  await openEvent(defeat);
  assert(await evaluate(`!document.querySelector('.ap-choices').textContent.includes('直接离开')`),'risk event offers no free leave option');
  await click('.ap-choice:first-child');await textButton('掷骰');await sleep(1500);await shot('19-defeat');
  const defeated=await stored();
  assert(defeated.expeditions.length===0&&defeated.pets[petId].injury==='incapacitated'&&defeated.settlements[0].lastResolution.check.type==='primary','incapacitated last pet ends expedition and preserves final dice in the defeat report');
  const stale=structuredClone(extraction);await openEvent(stale);await click('.ap-transfer section:first-child .ap-item');await textButton('确认撤离');
  const changed=await stored();changed.inventory.paper+=1;await seed(changed,false);
  assert(await evaluate(`!document.querySelector('[role="alertdialog"]')&&document.querySelector('.ap-warning').textContent.includes('变化')`),'changed warehouse invalidates an open extraction confirmation');
  const unsellable=structuredClone(extraction);unsellable.expeditions[0].cargo={'filled-dice':1};unsellable.expeditions[0].initialCargo={};
  const customCatalog=JSON.parse(readFileSync('src/domain/catalog.bundled.json','utf8'));
  customCatalog.items['filled-dice'].sellable=false;delete customCatalog.items['filled-dice'].sellValue;
  await evaluate(`localStorage.setItem('idle-pet-adventure.catalog.published.v6',${JSON.stringify(JSON.stringify(customCatalog))})`);
  await openEvent(unsellable);
  assert(await evaluate(`!!document.querySelector('.ap-unsellable')&&document.querySelector('.ap-footer .ap-primary').disabled`),'unsellable cargo blocks implicit sale');
  await textButton('标记丢弃');await textButton('确认撤离');
  assert(await evaluate(`document.querySelector('.ap-dialog').textContent.includes('丢弃')`),'discarding unsellable goods requires explicit final confirmation');
  const crowded=structuredClone(arrival);crowded.expeditions[0].cargo={'car-tire':30};crowded.expeditions[0].initialCargo={};
  await openEvent(crowded);
  assert(await evaluate(`Array.from(document.querySelectorAll('.ap-choices button')).every(b=>b.disabled)&&document.querySelector('.ap-choices').textContent.includes('背包超格')`),'over-slot cargo blocks continuation without silently dropping rewards');
  await textButton('整理背包');await textButton('丢弃全部');await shot('20-discard');
  await textButton('确认丢弃');await textButton('返回行动');
  assert(await evaluate(`!!document.querySelector('.ap-choices button:not(:disabled)')`),'confirmed cargo cleanup re-enables routes');
  const team=structuredClone(initial);
  for(let i=2;i<=4;i++) team.pets['test-pet-'+i]={...structuredClone(team.pets[petId]),id:'test-pet-'+i,name:'测试伙伴 '+i};
  await seed(team);for(let i=1;i<=3;i++) await click('.ap-pet-card:nth-child('+i+')');
  assert(await evaluate(`document.querySelectorAll('.ap-pet-card[aria-pressed="true"]').length===3&&document.querySelector('.ap-pet-card:nth-child(4)').disabled`),'preparation enforces a maximum of three selected pets');
  await shot('21-multiple-pets');
  assert(errors.length===0,'action flow has no renderer exceptions');
  writeFileSync(join(out,'result.json'),JSON.stringify({passed:true,profile,errors},null,2));console.log('Screenshots: '+out);
} catch(error) { console.error(error);console.error(logs);process.exitCode=1; }
finally { ws?.close();child.kill(); }
