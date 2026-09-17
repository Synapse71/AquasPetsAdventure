// 稀有度开箱视频的真机验收：Electron 里真的把 H.264 解出来了、画面铺满开箱区、
// 出来的是原片的颜色。这些不是看代码能确定的事，只有把画面抓下来数像素才算数。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

const port = 9300 + process.pid % 400;
const profile = mkdtempSync(join(tmpdir(), 'idle-chest-rarity-smoke-'));
const out = resolve('artifacts/chest-rarity-smoke');
mkdirSync(out, { recursive: true });
const child = spawn(electron, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'desktop/main.cjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '', ws;
child.stdout.on('data', d => { logs += d; });
child.stderr.on('data', d => { logs += d; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
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
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) { const cb = pending.get(m.id); pending.delete(m.id); cb?.(m); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const key = ++id, t = setTimeout(() => rej(new Error('Timed out: ' + method)), 20000);
    pending.set(key, m => { clearTimeout(t); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const assert = (ok, message) => { if (!ok) throw new Error('✗ ' + message); passed++; console.log('✓ ' + message); };
  const waitFor = async (expression, tries = 300) => {
    for (let i = 0; i < tries; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error('Condition not met: ' + expression);
  };
  const click = async selector => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(420);
  };
  const shot = async name => {
    const c = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, name + '.png'), Buffer.from(c.data, 'base64'));
    return c.data;
  };
  // 把截图送回页面里解码取色：要验的是**合成之后**的屏幕像素，页面内的 canvas 画不出来。
  const samplePixels = async (dataUrl, points) => evaluate(`(async()=>{
    const im=new Image();im.src='data:image/png;base64,${dataUrl}';await im.decode();
    const c=document.createElement('canvas');c.width=im.width;c.height=im.height;
    c.getContext('2d').drawImage(im,0,0);const g=c.getContext('2d');
    return ${JSON.stringify(points)}.map(p=>{const d=g.getImageData(Math.round(p.x*devicePixelRatio),Math.round(p.y*devicePixelRatio),1,1).data;
      return {name:p.name,r:d[0],g:d[1],b:d[2],lum:Math.round((d[0]+d[1]+d[2])/3)};});
  })()`);
  const stageBox = () => evaluate(`(()=>{const r=document.querySelector('.ap-chest-stage').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);

  await send('Runtime.enable'); await send('Page.enable');
  const loaded = () => waitFor(`!!document.querySelector('.pet-hit canvas[data-pose]')`);
  const open = async () => { await click('.pet-hit'); await click('.pet-bubbles button[aria-label="行动"]'); };
  const stored = () => evaluate(`JSON.parse(localStorage.getItem('idle-pet-adventure.demo.v1'))`);
  const textButton = async text => {
    const sel = await evaluate(`(()=>{const b=[...document.querySelectorAll('.adventure-panel button')].find(b=>b.textContent===${JSON.stringify(text)}&&!b.disabled);if(!b)throw Error('Missing '+${JSON.stringify(text)});b.dataset.smoke='t';return '[data-smoke="t"]'})()`);
    await click(sel); await evaluate(`document.querySelector('[data-smoke="t"]')?.removeAttribute('data-smoke')`);
  };
  // 只清掉开箱状态：整片 UI state 一清，面板会退回队伍列表，到不了开箱那一屏。
  const seedArrival = async fixture => {
    await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1',${JSON.stringify(JSON.stringify(fixture))});Object.keys(localStorage).filter(k=>k.includes('.chest-open-')).forEach(k=>localStorage.removeItem(k));`);
    await send('Page.reload'); await loaded(); await open();
    await waitFor(`!!document.querySelector('.ap-chest')`);
  };
  const seed = async (fixture, resetUI = true) => {
    await evaluate(`localStorage.setItem('idle-pet-adventure.demo.v1',${JSON.stringify(JSON.stringify(fixture))});${resetUI ? "Object.keys(localStorage).filter(k=>k.startsWith('idle-pet.ui.v1.')).forEach(k=>localStorage.removeItem(k));" : ''}`);
    await send('Page.reload'); await loaded(); await open();
  };

  await loaded();
  const initial = await stored(), fixture = structuredClone(initial), petId = Object.keys(initial.pets)[0];
  fixture.inventory = { paper: 3 }; fixture.unlockedMapIds = ['map-1'];
  fixture.pets[petId].baseStats = { fitness: 12, perception: 12, technique: 12 };
  await seed(fixture);
  await click('.ap-pet-card'); await textButton('选择探险地图'); await textButton('选择起始点');
  await click('.pickable .ap-map-node'); await textButton('行前整备'); await textButton('开始探索');
  let running = await stored(); running.expeditions[0].arriveAt = 0;
  await seed(running, false); await waitFor(`!!document.querySelector('.ap-route-choices')`);
  await click('.ap-route-choices button:first-child');
  running = await stored(); running.expeditions[0].arriveAt = 0;
  await seed(running, false); await waitFor(`!!document.querySelector('.ap-chest')`);
  const arrived = await stored();

  // ① 全是普通物品 → 播 common 那一档（六档齐全后它也有自己的素材）
  const commonState = structuredClone(arrived);
  commonState.expeditions[0].arrivalLoot = { paper: 2 };
  commonState.expeditions[0].pendingLoot = { paper: 2 };
  await seedArrival(commonState);
  assert(await evaluate(`(()=>{const fx=document.querySelector('.ap-chest-fx img');return !!fx&&/closed-still/.test(fx.src)})()`),
    '只有普通物品时，闭合图也是 common 那一档的首帧');
  await click('.ap-chest');
  await waitFor(`!!document.querySelector('.ap-chest-fx video')`);
  assert(await evaluate(`document.querySelector('.ap-chest-fx').dataset.rarity==='common'`), '战利品只有普通物品 → 播 common 那一档');
  assert(await evaluate(`!document.querySelector('.ap-chest img')`), '不再回退到老的通用木箱动画');

  // ② 出了神话物品 → 播 mythic 视频
  const seedRarity = async (item, rarity, andOpen = true) => {
    const s = structuredClone(arrived);
    s.expeditions[0].arrivalLoot = { paper: 1, [item]: 1 };
    s.expeditions[0].pendingLoot = { paper: 1, [item]: 1 };
    await seedArrival(s);
    assert(await evaluate(`(()=>{const fx=document.querySelector('.ap-chest-fx img');return !!fx&&/closed-still/.test(fx.src)&&!document.querySelector('.ap-chest img')})()`),
      `${rarity}：没点之前显示的就是这一档宝箱的首帧，不是通用木箱`);
    // 画在哪儿就得点哪儿：闭合状态下整块开箱区都是热区，不是原来那个 168px 槽位。
    assert(await evaluate(`(()=>{const b=document.querySelector('.ap-chest').getBoundingClientRect(),s=document.querySelector('.ap-chest-stage').getBoundingClientRect();
      return Math.abs(b.x-s.x)<1&&Math.abs(b.y-s.y)<1&&Math.abs(b.width-s.width)<1&&Math.abs(b.height-s.height)<1})()`),
      `${rarity}：闭合状态整块开箱区都能点开`);
    await shot(`01-${rarity}-closed`);
    if (!andOpen) return;
    await click('.ap-chest');
    await waitFor(`!!document.querySelector('.ap-chest-fx video')`);
  };
  await seedRarity('snow-beer', 'mythic');
  assert(await evaluate(`document.querySelector('.ap-chest-fx').dataset.rarity==='mythic'`), '战利品里最高是神话 → 播 mythic 那一档');
  // 闭合图是视频首帧，两者同一套画布：点下去宝箱不该换外观，也不该跳尺寸。
  assert(await evaluate(`(()=>{const v=document.querySelector('.ap-chest-fx video'),f=document.querySelector('.ap-chest-fx').getBoundingClientRect();
    return Math.abs(v.getBoundingClientRect().width-f.width)<1&&Math.abs(v.getBoundingClientRect().height-f.height)<1})()`),
    '视频和闭合图占同一块画布，点击瞬间宝箱不跳尺寸');
  await waitFor(`(()=>{const v=document.querySelector('.ap-chest-fx video');return v&&v.readyState>=2&&v.videoWidth>0})()`);
  const media = await evaluate(`(()=>{const v=document.querySelector('.ap-chest-fx video');return {w:v.videoWidth,h:v.videoHeight,dur:v.duration,err:v.error&&v.error.code}})()`);
  assert(media.w === 760 && media.h === 1208 && !media.err, `Electron 真的解出了 H.264（${media.w}×${media.h}，error=${media.err ?? 'none'}）`);
  await waitFor(`document.querySelector('.ap-chest-fx video').currentTime>0.4`);
  assert(await evaluate(`!document.querySelector('.ap-chest-fx video').paused`), '视频真的在播，不是卡在首帧');
  assert(await evaluate(`getComputedStyle(document.querySelector('.ap-chest-fx video')).mixBlendMode==='normal'`), '视频原样铺上去，没有抠图也没有混合模式');
  const fit = await evaluate(`(()=>{const a=document.querySelector('.ap-chest-fx').getBoundingClientRect(),b=document.querySelector('.ap-chest-stage').getBoundingClientRect();
    return Math.abs(a.x-b.x)<1&&Math.abs(a.y-b.y)<1&&Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1})()`);
  assert(fit, '视频层铺满整个开箱区（按策划说的当背景拉伸平铺）');

  // ③ 浅色主题下画面就是原片：开箱区中心在高潮帧应该是彩色的，不是面板底色
  await waitFor(`document.querySelector('.ap-chest-fx video').currentTime>3.4`, 120);
  const box = await stageBox();
  // 光柱芯本来就是白的，单点取样会取到白心；沿宝箱那一圈多点取最大色偏才说明得了问题。
  const ring = f => [[0.5, 0.62], [0.22, 0.74], [0.78, 0.74], [0.5, 0.82]].map(([u, v], i) => ({ name: 'p' + i, x: f.x + f.w * u, y: f.y + f.h * v }));
  const light = await samplePixels(await shot('02-mythic-light-peak'), ring(box));
  const warm = Math.max(...light.map(p => p.r - p.b));
  assert(warm > 60, `浅色主题高潮帧里是原片的橙红特效，不是一块白底（最大色偏 ${warm}）`);

  // ④ 播放中不能跳过，也不该冒出「点击跳过」之类的提示；要等它自己播完
  assert(await evaluate(`document.querySelector('.ap-chest').disabled&&document.querySelector('.ap-chest').getAttribute('aria-label')==='开启宝箱'`),
    '播放中宝箱按钮是禁用的，没有跳过入口');
  assert(await evaluate(`!document.querySelector('.ap-chest>span')`), '播放中不显示任何提示文字');
  await waitFor(`!document.querySelector('.ap-chest-fx video')`, 60);
  assert(await evaluate(`!!document.querySelector('.ap-chest-fx img')&&/open-still/.test(document.querySelector('.ap-chest-fx img').src)`),
    '播完自动换成末帧静帧');
  assert(await evaluate(`[...document.querySelectorAll('.ap-loot-card')].length>0`), '播完战利品照常出现，没有卡住开箱流程');
  // 视频的白和面板的白要是差一点，开箱区就会露出一个方框。末帧角落是干净白底，拿它量那道缝。
  const seam = await samplePixels(await shot('03-mythic-opened'), [
    { name: 'inside', x: box.x + 3, y: box.y + 3 },
    { name: 'outside', x: box.x - 8, y: box.y + 3 },
  ]);
  const gap = Math.max(...['r', 'g', 'b'].map(c => Math.abs(seam[0][c] - seam[1][c])));
  assert(gap <= 4, `视频白底和面板白底对得上，开箱区没有露出方框（最大通道差 ${gap}）`);
  const openedSave = await evaluate(`localStorage.getItem('idle-pet.ui.v1.chest-open-'+JSON.parse(localStorage.getItem('idle-pet-adventure.demo.v1')).expeditions[0].id)`);
  assert(!!openedSave && openedSave !== '""', '开箱状态已经落盘，刷新不会重播');

  // ⑤ 换一档再走一遍，确认选档不是写死的
  await seedRarity('cracked-core', 'legendary');
  assert(await evaluate(`document.querySelector('.ap-chest-fx').dataset.rarity==='legendary'`), '战利品里最高是传说 → 播 legendary 那一档');
  await waitFor(`document.querySelector('.ap-chest-fx video').currentTime>3.4`, 120);
  const dbox = await stageBox();
  const gold = await samplePixels(await shot('04-legendary-peak'), ring(dbox));
  const warmGold = Math.max(...gold.map(p => p.r - p.b));
  assert(warmGold > 60, `legendary 高潮帧是原片的金色（最大色偏 ${warmGold}）`);

  // ⑥ 「点击开启」提示：只在没点之前出现，而且要贴着箱子，不能掉到开箱区最底下
  await seedRarity('snow-beer', 'mythic', false);
  const hint = await evaluate(`(()=>{const el=document.querySelector('.ap-chest>span');if(!el)return null;
    const r=el.getBoundingClientRect(),s=document.querySelector('.ap-chest-stage').getBoundingClientRect();
    return {text:el.textContent,fromTop:(r.top-s.top)/s.height,fromBottom:(s.bottom-r.bottom)/s.height}})()`);
  assert(hint?.text === '点击开启', `没点之前显示「点击开启」（实际 ${hint?.text ?? '没有提示'}）`);
  // 画幅里箱体底边在 72% 处；提示落在 72%~88% 之间才算「贴着箱子」而不是掉到底。
  assert(hint.fromTop > 0.72 && hint.fromTop < 0.88,
    `提示贴在宝箱下方而不是开箱区最底下（距顶 ${(hint.fromTop * 100).toFixed(1)}%）`);
  await shot('06-closed-hint');

  assert(errors.length === 0, `渲染过程没有未捕获异常（${errors.length}）`);
  writeFileSync(join(out, 'result.json'), JSON.stringify({ passed, media, light, dark }, null, 2));
  console.log(`\n全部断言通过（${passed} 条）`);
} catch (e) { console.error(e); console.error(logs.slice(-3000)); process.exitCode = 1; }
finally { ws?.close(); child.kill(); }
