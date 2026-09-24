import { START_TRAVEL_DURATION_MS } from '../domain/expeditionTiming';
import { useEffect, useRef, useState } from 'react';
import { catalog } from '../domain/catalog';
import { cargoCapacity, cargoSlotCapacity, cargoSlotsUsed, chooseRoute, discardCargo, eatCargoFood, STAT_LABELS as MAIN_STAT_LABELS, eventCheckRisk, finishNodeLoot, GameRuleError, getRiskPreview, getRouteAvailability, getVisibleRoutes, hasEventRollAdvantage, inventorySlots, inventoryWeight, isChoiceAvailable, itemStackSize, lockedNodeEvents, mapInformationTier, overloadPenalty, pickupAllNodeLoot, pickupNodeLoot, primaryOutcomeForRoll, requestExtraction, resolveEvent, SECONDARY_STAT_LABELS, teamSecondaryStat } from '../domain/engine';
import type { EventChoiceDefinition, EventResolution, Expedition, GameState, Settlement } from '../domain/types';
import { AdventureItems } from './AdventureItems';
import { AdventureMap } from './AdventureMap';
import { OUTCOMES, routeHint, STAT_LABELS, timeLabel } from './adventureModel';
import { ExtractionView } from './ExtractionView';
import { EventOptionInfo } from './EventOptionInfo';
import { useUIState } from './uiState';
import { lootIconUrl } from './lootIcons';
import { RARITY_CHEST_MS, rarityChestFx, topLootRarity } from './chestRarity';
import { foodBuffNote, foodEatLabel, foodInCargo } from './foodModel';
import { cellQuantity } from './inventoryPanelModel';
import chestClosed from '../../assets/ui-prototype/chest/closed-frame.png';
import chestOpen from '../../assets/ui-prototype/chest/open-frame.png';
import chestAnimation from '../../assets/ui-prototype/chest/open-anim.webp';
import bagIcon from '../../assets/ui-prototype/icons/bag.png';

const dice = import.meta.glob<string>('../../assets/ui-prototype/dice/face-*.png', { eager: true, query: '?url', import: 'default' });
const stats = import.meta.glob<string>(['../../assets/ui-prototype/icons/stat-*.png', '!../../assets/ui-prototype/icons/*-sheet.png'], { eager: true, query: '?url', import: 'default' });
const face = (n: number) => dice[`../../assets/ui-prototype/dice/face-${n}.png`];
const statIcon = (key: string) => stats[`../../assets/ui-prototype/icons/stat-${key}.png`];
const resolutionOf = (c: EventChoiceDefinition) => c.resolution ?? {type:'primary' as const,stat:c.stat ?? 'perception',difficulty:c.difficulty ?? 0};
const DICE_MS = 1470;
const colors = { common:'#e3e3e3',uncommon:'#a8dc82',rare:'#74b9f0',epic:'#b98bee',legendary:'#f3c63c',mythic:'#ef6b55' };

/** Prototype C: fast face changes, cubic deceleration, diminishing hops, then a landing pop.
 * Random faces here are presentation only; the final faces always come from the saved check. */
function Dice({ rolls, animate, onDone, onRoll }: {rolls:number[];animate:boolean;onDone?:()=>void;onRoll?:()=>void}) {
  const root = useRef<HTMLDivElement>(null), done = useRef(onDone);
  done.current = onDone;
  const key = rolls.join(',');
  useEffect(() => {
    if (!animate || !root.current) return;
    const slots = [...root.current.querySelectorAll<HTMLElement>('.ap-die-slot')];
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, stopped = false;
    const t0 = performance.now(), last = slots.map(() => -1);
    const setFace = (slot:HTMLElement,n:number) => slot.querySelectorAll<HTMLImageElement>('img').forEach(im => im.classList.toggle('on',Number(im.dataset.face)===n));
    const frame = (now:number) => {
      if(stopped)return;
      const p = reduce ? 1 : Math.min(1,(now-t0)/DICE_MS), ease = 1-Math.pow(1-p,3), index = Math.floor(ease*18);
      slots.forEach((slot,i) => {
        const lift=slot.querySelector<HTMLElement>('.ap-die-lift')!,shadow=slot.querySelector<HTMLElement>('.ap-die-shadow')!;
        if(last[i] !== index){last[i]=index;setFace(slot,index>=17?rolls[i]:1+Math.floor(Math.random()*6));}
        const hop=Math.abs(Math.sin(p*Math.PI*18*.55))*26*(1-ease),rot=Math.sin(p*Math.PI*18*.42)*15*(1-ease);
        lift.style.transform=`translateY(${-hop}px) rotate(${rot}deg)`;
        shadow.style.transform=`translateX(-50%) scale(${1-hop/70})`;
        shadow.style.opacity=String(.3-hop/260);
        if(p===1){setFace(slot,rolls[i]);slot.querySelector('.ap-die')!.classList.add('land');}
      });
      if(p<1)raf=requestAnimationFrame(frame);else done.current?.();
    };
    raf=requestAnimationFrame(frame);
    return()=>{stopped=true;cancelAnimationFrame(raf);};
  },[animate,key]);
  return <div ref={root} className={`ap-dice-wrap${animate?' rolling':''}`} data-animation={animate?'rolling':'settled'}><button className="ap-dice-button" aria-label={onRoll ? '点击骰子掷出判定' : '骰子判定结果'} disabled={!onRoll || animate} onClick={onRoll}><div className="ap-dice">{rolls.map((n,i)=><div className="ap-die-slot" key={i}><div className="ap-die-shadow"/><div className="ap-die-lift"><div className="ap-die">{[1,2,3,4,5,6].map(f=><img key={f} data-face={f} className={f===n?'on':''} src={face(f)} alt={f===n ? animate?'掷骰中':`骰点 ${n}`:''} draggable={false}/>)}</div></div><div className="ap-die-label">{!onRoll && !animate && rolls.length>1 ? n===Math.max(...rolls)?'取最高':'舍弃':''}</div></div>)}</div></button></div>;
}

function SecondaryTrack({ choice, value, tier, animate, onDone }: {choice:EventChoiceDefinition;value:number;tier:number;animate:boolean;onDone?:()=>void}) {
  const pointer=useRef<HTMLDivElement>(null),done=useRef(onDone);
  done.current=onDone;
  const r=resolutionOf(choice);
  const max=r.type==='secondary'?Math.max(r.extraSuccessThreshold+2,value+1):value+1;
  useEffect(()=>{
    if(!animate)return;
    let raf=0;const t0=performance.now(),reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame=(now:number)=>{const p=reduce?1:Math.min(1,(now-t0)/620),v=value*(1-Math.pow(1-p,3));
      if(pointer.current){pointer.current.style.left=`${v/max*100}%`;pointer.current.querySelector('b')!.textContent=String(Math.round(v));}
      if(p<1)raf=requestAnimationFrame(frame);else done.current?.();
    };raf=requestAnimationFrame(frame);return()=>cancelAnimationFrame(raf);
  },[animate,value,max]);
  if(r.type!=='secondary')return null;
  const full=tier===3,out=value>=r.extraSuccessThreshold?'extra-success':'success';
  return <div className="ap-secondary-track-wrap"><div className="ap-secondary-label"><img src={statIcon(r.stat)} alt=""/>队伍{SECONDARY_STAT_LABELS[r.stat]}最高值 <b>{value}</b>{full && <>　成功线 <b>{r.successThreshold}</b>　大成功线 <b>{r.extraSuccessThreshold}</b></>}</div>
    {full ? <div className="ap-secondary-track"><span style={{width:`${r.successThreshold/max*100}%`}}>不足</span><span className="success" style={{width:`${(r.extraSuccessThreshold-r.successThreshold)/max*100}%`}}>成功</span><span className="extra-success" style={{width:`${(max-r.extraSuccessThreshold)/max*100}%`}}>大成功</span><i className="ap-secondary-gate" style={{left:`${r.successThreshold/max*100}%`}}>{r.successThreshold}</i><i className="ap-secondary-gate" style={{left:`${r.extraSuccessThreshold/max*100}%`}}>{r.extraSuccessThreshold}</i><div ref={pointer} className={`ap-secondary-pointer ${out}`} style={{left:`${animate?0:value/max*100}%`}}><b>{animate?0:value}</b></div></div> : <div className="ap-secondary-private">{animate?'正在比对队伍属性…':'属性比对完成'}</div>}
    <p className="ap-secondary-note">次要属性不掷骰：达到成功条件即成功，达到大成功条件则获得额外收获。</p></div>;
}
export function EventResult({result}:{result:EventResolution}) {
  return <div className="ap-result" aria-live="polite"><h2 className={`ap-outcome ${result.outcome}`}>{OUTCOMES[result.outcome]}</h2><p>{result.summary}</p><AdventureItems inventory={result.reward} rows empty="这次没有获得任何物品"/>{!!Object.keys(result.reward).length && <small>已直接放入背包，无需拾取</small>}</div>;
}

export function ExpeditionView({ game, expedition, now, run, onFinished, onDeciding }: { game: GameState; expedition: Expedition; now: number; run: (action: (s: GameState) => GameState) => boolean; onFinished: (report: Settlement) => void; onDeciding?: (e:Expedition)=>void }) {
  const [seen,setSeen]=useUIState(`result-seen-${expedition.id}`,'',(v):v is string=>typeof v==='string');
  const [choiceId,setChoiceId]=useUIState(`event-choice-${expedition.id}`,'',(v):v is string=>typeof v==='string');
  const [resultPage,setResultPage]=useUIState(`event-result-page-${expedition.id}`,'',(v):v is string=>typeof v==='string');
  const [opened,setOpened]=useUIState(`chest-open-${expedition.id}`,'',(v):v is string=>typeof v==='string');
  const [showBag,setShowBag]=useUIState(`expedition-bag-${expedition.id}`,false,(v):v is boolean=>typeof v==='boolean');
  const [showMap,setShowMap]=useState(false);
  const [rolling,setRolling]=useState(false),[chestPlaying,setChestPlaying]=useState(false);
  const [askLeave,setAskLeave]=useState(false),[selectedCargo,setSelectedCargo]=useState<{id:string;index:number}>();
  const [drop,setDrop]=useUIState<{id:string;q:number;index:number;basis:string}|null>(`action-drop-${expedition.id}`,null,(v):v is {id:string;q:number;index:number;basis:string}|null=>v===null||!!v&&typeof v==='object'&&'id' in v&&typeof v.id==='string'&&!!catalog.items[v.id]&&'q' in v&&Number.isSafeInteger(v.q)&&Number(v.q)>0&&'index' in v&&Number.isSafeInteger(v.index)&&Number(v.index)>=0&&'basis' in v&&typeof v.basis==='string');
  const [tip,setTip]=useState<{id:string;x:number;y:number}>();
  const [taking,setTaking]=useState<string>();
  const busy=useRef(false),chestTimer=useRef<number|undefined>(undefined),takeTimer=useRef<number|undefined>(undefined);
  const chestVideo=useRef<HTMLVideoElement|null>(null);
  useEffect(()=>()=>{clearTimeout(chestTimer.current);clearTimeout(takeTimer.current);},[]);
  useEffect(()=>{if(drop&&(drop.basis!==JSON.stringify(expedition.cargo)||expedition.phase==='traveling'))setDrop(null);},[drop,expedition.cargo,expedition.phase,setDrop]);
  const map=catalog.maps[expedition.mapId],node=map.nodes[expedition.currentNodeId??''];
  const tier=mapInformationTier(game,map.id,expedition.petIds),result=expedition.lastResolution;
  const arrivalKey=`${expedition.currentNodeId}:${expedition.visitedNodeIds.length}`;
  const arrival=expedition.pendingLoot!==undefined;
  const resultKey=result?`${arrivalKey}:${result.eventId}:${result.choiceId}`:'';
  const showResult=!!result && resultKey!==seen && !arrival;
  const event=catalog.events[(showResult?result?.eventId:expedition.currentEventId)??''];
  const choice=event?.choices.find(c=>`${event.id}:${expedition.visitedNodeIds.length}:${c.id}`===choiceId);
  const resultChoice=showResult?event?.choices.find(c=>c.id===result!.choiceId):undefined;
  const judgedChoice=resultChoice??choice, resolution=judgedChoice?resolutionOf(judgedChoice):undefined;
  const risk=showResult && result?.check?.type==='primary'?result.check.risk:choice?eventCheckRisk(game,expedition.id,choice.id):undefined;
  const weight=inventoryWeight(expedition.cargo),capacity=cargoCapacity(game,expedition),slots=cargoSlotCapacity(game,expedition),used=cargoSlotsUsed(expedition),overSlots=used>slots;
  const over=overloadPenalty(weight/Math.max(1,capacity));
  const remainder=Object.values(expedition.pendingLoot??{}).reduce((s,q)=>s+q,0);
  // 开箱动画看这次到站开出了什么：有普通以上的东西就播那一档的视频，全是普通物品维持原来的木箱动画。
  // 判定用 arrivalLoot 而不是 pendingLoot——边拾取边缩水的话，播到一半动画会降档。
  const lootRarity=topLootRarity(expedition.arrivalLoot),rarityFx=rarityChestFx(lootRarity);
  const playFx=!!rarityFx && !(typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  // 有这一档素材时，闭合 / 播放 / 播完三态全部用它：闭合图就是视频首帧、末帧图就是视频末帧，
  // 所以点下去宝箱不会当场换成另一只，也不会跳尺寸。没有素材的档（目前是 common）走原来的木箱动画。
  const chestShowsFx=!!rarityFx;
  // 视频一直挂着，所以这里只负责从头播。autoPlay 做不到这件事——它只在 mount 时生效。
  useEffect(()=>{
    const video=chestVideo.current;
    if(!video||!chestPlaying||!playFx)return;
    video.currentTime=0;
    void video.play().catch(()=>{/* 被策略挡住时由 chestTimer 兜底收尾 */});
  },[chestPlaying,playFx]);
  const finishChest=()=>{clearTimeout(chestTimer.current);setOpened(arrivalKey);setChestPlaying(false);};
  const openChest=()=>{
    if(chestPlaying)return;
    setChestPlaying(true);
    // 视频靠 onEnded 收尾，这个定时器是兜底（解码失败、被策略挡住时也要能继续）。
    // 关掉动效时没有动画可等，有素材的档直接开箱，不要干等一段空白。
    chestTimer.current=window.setTimeout(finishChest,playFx?RARITY_CHEST_MS:rarityFx?0:1286);
  };
  const room=(id:string)=>{const stack=itemStackSize(id),held=expedition.cargo[id]??0;return (held%stack?stack-held%stack:0)+Math.max(0,slots-used)*stack;};
  // 整理背包按格操作：点哪一格就只动那一格，同名的其它格子不受影响。
  const selectedCellQty=selectedCargo?cellQuantity(expedition.cargo[selectedCargo.id]??0,itemStackSize(selectedCargo.id),selectedCargo.index):0;
  const selectedCellCount=selectedCargo?Math.ceil((expedition.cargo[selectedCargo.id]??0)/itemStackSize(selectedCargo.id)):0;
  const duration=map.nodes[expedition.travelingFromNodeId??'']?.edges.find(e=>e.id===expedition.travelingEdgeId)?.durationMs??START_TRAVEL_DURATION_MS;
  const progress=Math.max(0,Math.min(100,100*(1-(expedition.arriveAt-now)/Math.max(1,duration))));
  const time=Math.max(0,Math.ceil((expedition.arriveAt-now)/1000));
  const countdown=`${String(Math.floor(time/60)).padStart(2,'0')}:${String(time%60).padStart(2,'0')}`;
  const showJudge=!!judgedChoice && (!showResult || (resultPage!==resultKey && !!result?.check && result.check.type!=='leave'));
  const decide=(selected=choice)=>{
    if(!selected || busy.current || arrival)return;
    busy.current=true;
    onDeciding?.(expedition);
    const eventId=event.id,kind=resolutionOf(selected).type;
    const ok=run(state=>{
      const current=state.expeditions.find(e=>e.id===expedition.id);
      if(current?.currentEventId!==eventId || current.visitedNodeIds.length!==expedition.visitedNodeIds.length)throw new GameRuleError('事件已变化，请重新选择。');
      return resolveEvent(state,expedition.id,selected.id);
    });
    if(ok){setChoiceId('');setTip(undefined);setRolling(kind!=='leave');}
    busy.current=false;
  };
  const autoKey=useRef('');
  useEffect(()=>{
    if(choice && resolutionOf(choice).type==='secondary' && !showResult && autoKey.current!==choiceId){
      autoKey.current=choiceId;decide(choice);
    }
  },[choiceId,showResult]);
  const openTip=(el:HTMLButtonElement,id:string)=>{
    const panel=el.closest('.adventure-panel')!.getBoundingClientRect(),r=el.getBoundingClientRect();
    setTip({id,x:Math.min(panel.width-290,Math.max(12,r.left-panel.left)),y:Math.min(panel.height-240,Math.max(52,r.bottom-panel.top+5))});
  };
  const lockedHints=(id:string)=>lockedNodeEvents(game,{mapId:map.id,nodeId:id,petIds:expedition.petIds}).map(({eventId,gate})=><p className="ap-muted" key={eventId}>尚有未触发事件：{tier===1?`${SECONDARY_STAT_LABELS[gate.stat]}不足`:`需要${SECONDARY_STAT_LABELS[gate.stat]}达到 ${gate.required}`}</p>);
  const finish=()=>{setSeen(resultKey);setResultPage('');const report=game.settlements.find(s=>s.expeditionId===expedition.id);if(report)onFinished(report);};
  const lootNext=(discard=false)=>{if(run(s=>finishNodeLoot(s,expedition.id,discard))){setAskLeave(false);setOpened('');}};
  const take=(id:string,whole=false)=>{
    if(taking)return;
    const q=Math.min(expedition.pendingLoot?.[id]??0,whole?itemStackSize(id):1,room(id));
    if(!q)return;
    const apply=()=>{run(s=>pickupNodeLoot(s,expedition.id,id,q));setTaking(undefined);};
    if(q===(expedition.pendingLoot?.[id]??0)){setTaking(id);takeTimer.current=window.setTimeout(apply,280);}else apply();
  };
  const gauges=<div className={`ap-weight${over?' over':''}`}><span>负重</span><i><b style={{width:`${Math.min(100,weight/Math.max(1,capacity)*100)}%`}}/></i><span>{weight} / {capacity}{over?`　风险 +${over}`:''}</span></div>;
  const eventCard=event && <div className="ap-event-card"><div><strong>{event.title}</strong>{!event.choices.some(c=>resolutionOf(c).type==='leave') && <span className="ap-required-event">无法离开</span>}</div><p>{event.description}</p></div>;
  if(expedition.phase==='extraction' && !showResult && !arrival)return <ExtractionView key={expedition.id} game={game} expedition={expedition} run={run} onFinished={onFinished}/>;
  return <>
    <div className="ap-expedition-tools"><button className="ap-bag-button" onClick={()=>setShowBag(true)} aria-label="查看探险背包"><img src={bagIcon} alt=""/>{weight} / {capacity}{over>0 && <b>+{over}</b>}</button><button onClick={()=>setShowMap(true)} aria-label="查看地图">地图</button>{expedition.foodBuff&&<span className="ap-food-buff" title={`来自${catalog.items[expedition.foodBuff.itemId]?.name??expedition.foodBuff.itemId}，整趟有效。队伍级加成，不改变单只宠物的属性。`}>{MAIN_STAT_LABELS[expedition.foodBuff.stat]} +{expedition.foodBuff.amount}</span>}</div>
    <div className={`ap-body${expedition.phase==='traveling' && !showResult?' ap-center':''}`} onScroll={()=>setTip(undefined)}>
      {arrival ? <div className="ap-transfer ap-arrival-layout">
        <section><div className="ap-sec-h">{node?.name}</div><div className="ap-chest-stage">{chestShowsFx&&<div className="ap-chest-fx" data-rarity={lootRarity} aria-hidden="true">
          {/* 三层都从一开始就挂着，全程不 mount/unmount——点下去才创建 <video> 的话，
              解码器要现开，中间有几帧什么都画不出来，那一下就是闪白。
              末帧图垫在最底下：它一直在渲染树里，播完只是把上层藏掉，不用现解码。
              视频的 poster 用闭合首帧，加载完成前后画面完全一致，看不出切换。 */}
          <img src={rarityFx!.still} alt=""/>
          <video ref={chestVideo} key={rarityFx!.clip} src={rarityFx!.clip} poster={rarityFx!.closed}
            muted playsInline preload="auto" onEnded={finishChest} hidden={opened===arrivalKey}/>
        </div>}<div className="ap-loot-float">{opened===arrivalKey && !chestPlaying && (remainder ? Object.entries(expedition.arrivalLoot).map(([id])=>{
          const q=expedition.pendingLoot?.[id]??0,item=catalog.items[id];
          return q ? <button key={id} className={`ap-loot-card${taking===id?' taking':''}`} disabled={!room(id)} aria-label={`拾取 ${item.name} ×${q}`} title={item.name} style={{'--item-color':colors[item.rarity]} as React.CSSProperties} onClick={()=>take(id)} onContextMenu={e=>{e.preventDefault();take(id,true);}}><span/><img src={lootIconUrl(id)} alt=""/>{q>1&&<b>{q}</b>}</button> : <span key={id} className="ap-loot-slot"/>;
        }) : <p className="ap-muted">战利品已全部收入背包</p>)}</div><button className={`ap-chest ${opened===arrivalKey?'open':'closed'}${chestShowsFx?' fx':''}`} disabled={opened===arrivalKey || chestPlaying} aria-label="开启宝箱" onClick={openChest}>{!chestShowsFx&&<img src={chestPlaying?chestAnimation:opened===arrivalKey?chestOpen:chestClosed} alt="宝箱"/>}{opened!==arrivalKey&&!chestPlaying&&<span>点击开启</span>}</button></div></section>
        <section className="ap-bag-col"><h3>探险背包 <span>{used} / {slots} 格</span></h3><div className="ap-loadout-tools">{gauges}<button onClick={()=>setShowBag(true)}>整理</button></div><AdventureItems inventory={expedition.cargo} slots={slots}/></section>
      </div> : showResult || (expedition.phase==='awaiting-event' && event) ? <>
        {eventCard}
        {showJudge && judgedChoice ? <div className="ap-judge">
          <div className="ap-judge-head"><strong>{judgedChoice.label}</strong><span>{resolution?.type==='primary' ? tier===3?`风险 ${risk}`:hasEventRollAdvantage(game,expedition)?'幸运儿 · 两次掷骰取最高':'' : resolution?.type==='secondary'?`免掷骰 · 取队伍最高${SECONDARY_STAT_LABELS[resolution.stat]}`:''}</span>{resolution?.type==='primary'&&tier===3&&<span className="ap-risk-explanation"><button aria-label="风险计算说明">?</button><span role="tooltip"><b>风险 {risk}</b><br/>事件难度 − 队伍主属性{foodBuffNote(expedition,resolution.stat)} + 超载惩罚 + 伤势惩罚<br/>骰点减去风险，就是本次结果值。</span></span>}</div>
          {resolution?.type==='primary' ? <>
            <div className={`ap-outcome-scale${tier!==3?' undisclosed':''}`} aria-label={tier===3?'骰点结果区间':'情报不足，隐藏结果区间'}>{tier===3 && risk!==undefined && [1,2,3,4,5,6].map(n=><span key={n} className={`${primaryOutcomeForRoll(n,risk)}${showResult&&!rolling&&result?.check?.type==='primary'&&n===Math.max(...result.check.rolls)?' hit':''}`}>{n}</span>)}</div>
            <Dice rolls={showResult && result?.check?.type==='primary'?result.check.rolls:hasEventRollAdvantage(game,expedition)?[1,1]:[1]} animate={rolling} onDone={()=>setRolling(false)} onRoll={!showResult?()=>decide():undefined}/>
          </> : resolution?.type==='secondary' ? <SecondaryTrack choice={judgedChoice} value={result?.check?.type==='secondary' && showResult?result.check.value:teamSecondaryStat(game,expedition.petIds,resolution.stat)} tier={tier} animate={rolling} onDone={()=>setRolling(false)}/> : null}
          <div className={`ap-verdict${showResult&&!rolling?' show':''}`} aria-live="polite">{showResult&&!rolling&&<><span>{result?.check?.type==='primary' ? tier===3?`骰点 ${Math.max(...result.check.rolls)} − 风险 ${result.check.risk} ＝ ${Math.max(...result.check.rolls)-result.check.risk}`:`掷出 ${result.check.rolls.join(' / ')}${result.check.rolls.length>1?' · 取最高':''}` : result?.check?.type==='secondary'?`队伍属性 ${result.check.value}`:''}</span><b className={result!.outcome}>{OUTCOMES[result!.outcome]}</b></>}</div>
        </div> : showResult ? <EventResult result={result!}/> : <div className="ap-choices ap-event-choices">{event?.choices.map(c=>{
          const av=isChoiceAvailable(game,expedition,c),r=resolutionOf(c),p=getRiskPreview(game,expedition.id,c.id);
          const label=r.type==='leave'?'':r.type==='secondary'?SECONDARY_STAT_LABELS[r.stat]:STAT_LABELS[r.stat];
          const hasTip=r.type!=='secondary'||!!p.label||!!p.detail;
          return <button key={c.id} className="ap-choice ap-event-option" aria-disabled={!av.available} onMouseEnter={e=>hasTip&&openTip(e.currentTarget,c.id)} onMouseLeave={()=>setTip(undefined)} onFocus={e=>hasTip&&openTip(e.currentTarget,c.id)} onBlur={()=>setTip(undefined)} onClick={()=>{if(!av.available)return;setTip(undefined);if(r.type==='leave')decide(c);else setChoiceId(`${event!.id}:${expedition.visitedNodeIds.length}:${c.id}`);}}><span className="ap-option-top"><strong>{c.label}</strong>{r.type!=='leave'&&<em><img src={statIcon(r.stat)} alt=""/>{label}</em>}</span><small>{c.description}</small></button>;
        })}</div>}
      </> : expedition.phase==='traveling' ? <div className="ap-travel"><h2>{expedition.travelingEdgeId?map.nodes[expedition.travelingFromNodeId??'']?.edges.find(e=>e.id===expedition.travelingEdgeId)?.label:`从${map.nodes[map.startNodeId].name}出发`}</h2><p>{map.name}</p><div className="ap-travel-track"><i style={{width:`${progress}%`}}/></div><strong className="ap-countdown">{countdown}<small>剩余时间</small></strong></div> : <>
        <div className="ap-sec-h">选择下一段路线 <em>当前位置：{node?.name}</em></div><div className="ap-choices ap-route-choices">{getVisibleRoutes(game,expedition.id).map(edge=>{
          const av=getRouteAvailability(game,expedition.id,edge.id),hint=routeHint(game,expedition.petIds,edge,tier);
          return <button className="ap-choice" key={edge.id} disabled={!av.available||overSlots} onClick={()=>{if(run(s=>chooseRoute(s,expedition.id,edge.id))){setChoiceId('');setShowBag(false);}}}><span><strong>{edge.label}</strong><small>{edge.description}</small>{hint&&<small>{hint}</small>}</span><em><small>行进时间</small>{overSlots?'背包超格':tier===1?'未知':timeLabel(edge.durationMs)}</em></button>;
        })}{node?.extractable && node.id!==map.startNodeId && <button className="ap-choice" onClick={()=>run(s=>requestExtraction(s,expedition.id))}><span><strong>就地撤离</strong><small>带着现有战利品结束本次冒险</small></span></button>}</div>{node&&lockedHints(node.id)}
      </>}
    </div>
    <footer className={`ap-footer${expedition.phase==='traveling'&&!showResult?' idle':''}`}><span>{arrival ? opened!==arrivalKey?'开启宝箱获取战利品':used>=slots&&remainder?'背包格子已满，装不下更多战利品':over?`超载，事件风险 +${over}`:remainder?'点击战利品放入背包':'战利品已全部收入背包' : showResult ? rolling?resolution?.type==='secondary'?'比对中…':'掷骰中…':'' : choice?'点击骰子掷出判定':expedition.phase==='awaiting-event'?'选择一个应对方式':`已探索 ${expedition.completedNodeCount} 个节点`}</span>
      {arrival ? opened===arrivalKey&&!chestPlaying&&<>{remainder>0&&<button disabled={!!taking} onClick={()=>run(s=>pickupAllNodeLoot(s,expedition.id))}>全部拾取</button>}<button className="ap-primary" disabled={!!taking} onClick={()=>remainder?setAskLeave(true):lootNext()}>继续 · {expedition.phase==='awaiting-event'?'事件':expedition.phase==='extraction'?'准备撤离':'选择路线'}</button></> : showResult ? <button className="ap-primary" disabled={rolling} onClick={()=>showJudge?setResultPage(resultKey):finish()}>{showJudge?'查看结果':`继续 · ${game.settlements.some(s=>s.expeditionId===expedition.id)?'查看战报':expedition.phase==='extraction'?'准备撤离':'选择路线'}`}</button> : choice && <button disabled={rolling} onClick={()=>setChoiceId('')}>重选</button>}
    </footer>
    {tip&&event&&!choice&&!showResult&&<div className="ap-event-tip" role="tooltip" style={{left:tip.x,top:tip.y}}><EventOptionInfo preview={getRiskPreview(game,expedition.id,tip.id)} secondary={event.choices.find(c=>c.id===tip.id)?.resolution?.type==='secondary'}/></div>}
    {showMap&&<div className="ap-mask"><section className="ap-map-dialog"><button className="ap-dialog-x" aria-label="关闭地图" onClick={()=>setShowMap(false)}>×</button><AdventureMap game={game} mapId={map.id} petIds={expedition.petIds} currentNodeId={expedition.currentNodeId}/></section></div>}
    {showBag&&<div className="ap-mask"><section className="ap-dialog ap-bag-dialog" role="dialog" aria-label="整理背包"><h2>整理背包<button className="ap-dialog-x" aria-label="关闭背包" onClick={()=>setShowBag(false)}>×</button></h2><div className="ap-bag-gauges">{gauges}<span>格子 {used} / {slots}</span></div><AdventureItems inventory={expedition.cargo} onPick={(id,_q,index)=>setSelectedCargo({id,index})}/>{expedition.phase==='traveling'?<p>行进途中只能查看，抵达后才能整理</p>:selectedCargo&&selectedCellQty>0?<div className="ap-bag-actions">{foodInCargo(selectedCargo.id)&&<button className="ap-eat" disabled={!!taking} onClick={()=>{if(run(s=>eatCargoFood(s,expedition.id,selectedCargo.id)))setSelectedCargo(undefined);}}>吃掉 · {foodEatLabel(game,expedition,selectedCargo.id)}</button>}<span>丢弃 <b>{catalog.items[selectedCargo.id].name}</b><small className="ap-cell-note">第 {selectedCargo.index+1}/{selectedCellCount} 格 · 本格 {selectedCellQty} 件</small></span>{[1,selectedCellQty].filter((q,i,all)=>q>0&&all.indexOf(q)===i).map(q=><button key={q} disabled={rolling} onClick={()=>setDrop({id:selectedCargo.id,q,index:selectedCargo.index,basis:JSON.stringify(expedition.cargo)})}>{q===1?'丢 1 件':`丢本格 ${q} 件`}</button>)}</div>:<p>点一件东西来丢掉 · 丢掉的不会再回来</p>}</section></div>}
    {askLeave&&<div className="ap-mask"><section className="ap-dialog" role="alertdialog" aria-label="放弃未拾取战利品"><h2>还有 {remainder} 件战利品没有拾取</h2><p>离开后，没有放进背包的战利品会被永久丢弃。</p><div className="ap-dialog-actions"><button onClick={()=>setAskLeave(false)}>回去拾取</button><button className="ap-danger" onClick={()=>lootNext(true)}>确认丢弃并继续</button></div></section></div>}
    {drop&&<div className="ap-mask"><section className="ap-dialog" role="alertdialog" aria-label="确认丢弃"><h2>丢弃 {catalog.items[drop.id].name} ×{drop.q}？</h2><p>只丢第 {drop.index+1} 格里的 {drop.q} 件，同名的其它格子保留。丢弃后无法找回。</p><div className="ap-dialog-actions"><button onClick={()=>setDrop(null)}>取消</button><button className="ap-danger" onClick={()=>{if(run(s=>{const e=s.expeditions.find(e=>e.id===expedition.id);if(JSON.stringify(e?.cargo)!==drop.basis)throw new GameRuleError('背包已变化，请重新选择。');if(drop.q>cellQuantity(e?.cargo[drop.id]??0,itemStackSize(drop.id),drop.index))throw new GameRuleError('这一格的数量已变化，请重新选择。');return discardCargo(s,expedition.id,drop.id,drop.q);})){setDrop(null);setSelectedCargo(undefined);}}}>确认丢弃</button></div></section></div>}
  </>;
}
