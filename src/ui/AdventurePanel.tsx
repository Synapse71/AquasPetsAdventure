import { useEffect, useMemo, useState } from 'react';
import { catalog } from '../domain/catalog';
import { cargoCapacity, cargoSlotCapacity, completeTask, dismissSettlement, GameRuleError, inventorySlots, inventoryWeight, itemStackSize, overloadPenalty, INJURY_LABELS, mapIsCleared, MAX_TEAM_PETS, petEffectiveStats, petSecondaryStat, petTags, SECONDARY_STAT_LABELS, startExpedition, taskCanComplete, taskIsAvailable, taskRewardFitsWarehouse } from '../domain/engine';
import { PLAYER_MILESTONE_LABELS } from '../domain/milestones';
import type { Expedition, GameState, Inventory, SecondaryStatKey, Settlement, StatKey } from '../domain/types';
import { AdventureItems } from './AdventureItems';
import { AdventureMap } from './AdventureMap';
import { ExpeditionView } from './ExpeditionView';
import { PetPortrait } from './CodexPanel';
import { changeQuantity, isInventory, STAT_LABELS, subtract, timeLabel } from './adventureModel';
import { saleValue } from './inventoryPanelModel';
import { itemTagLabel } from '../domain/itemTags';
import { useUIState } from './uiState';
import './adventurePanel.css';
import './adventurePrototype.css';

type Run = (action: (state: GameState) => GameState) => boolean;
interface View { tab: 'explore' | 'tasks'; screen: 'overview' | 'prepare' | 'expedition' | 'report'; step: number; mapId: string; petIds: string[]; cargo: Inventory; expeditionId: string; reportId: string }
const isView = (v: unknown): v is View => {
  if (!v || typeof v !== 'object') return false;
  const s = v as View;
  return ['explore', 'tasks'].includes(s.tab) && ['overview', 'prepare', 'expedition', 'report'].includes(s.screen) && Number.isInteger(s.step) && s.step >= 0 && s.step <= 3 && typeof s.mapId === 'string' && Array.isArray(s.petIds) && s.petIds.length <= MAX_TEAM_PETS && s.petIds.every(id => typeof id === 'string') && new Set(s.petIds).size === s.petIds.length && isInventory(s.cargo) && typeof s.expeditionId === 'string' && typeof s.reportId === 'string';
};
const steps = ['选择伙伴', '选择地图', '确认入口', '携带物品'];
const phaseNames = { traveling: '行进中', 'awaiting-event': '处理事件', 'awaiting-route': '选择路线', extraction: '撤离整理' };

function TaskView({ game, run }: { game: GameState; run: Run }) {
  const tasks = Object.values(catalog.tasks).filter(t => taskIsAvailable(game, t.id));
  const [selected, setSelected] = useUIState('action-task-id', '', (v): v is string => typeof v === 'string');
  const task = tasks.find(t => t.id === selected) ?? tasks[0];
  return <><div className="ap-body ap-task-layout"><nav aria-label="任务列表">{tasks.map(t => <button key={t.id} aria-pressed={t.id === task?.id} onClick={() => setSelected(t.id)}><strong>{t.title}</strong><small>{taskCanComplete(game, t.id) ? '可提交' : '进行中'}</small></button>)}{!tasks.length && <p className="ap-muted">暂无可用任务</p>}</nav><section>{task ? <><p className="ap-kicker">任务</p><h2>{task.title}</h2><p className="ap-description">{task.description}</p><h3>完成条件</h3><ul className="ap-task-checks">{Object.entries(task.requirement.items ?? {}).map(([id, q]) => <li key={id} className={(game.inventory[id] ?? 0) >= q ? 'done' : ''}><span>{catalog.items[id]?.name} ×{q}</span><b>{game.inventory[id] ?? 0} / {q}</b></li>)}{task.requirement.currency !== undefined && <li className={game.currency >= task.requirement.currency ? 'done' : ''}><span>提交通用货币</span><b>{game.currency} / {task.requirement.currency}</b></li>}{(task.requirement.goals ?? []).map((goal, i) => { const done = goal.type === 'clear-map' ? mapIsCleared(game, goal.mapId) : game.completedMilestoneIds?.includes(goal.milestoneId); return <li key={i} className={done ? 'done' : ''}><span>{goal.type === 'clear-map' ? `通关 ${catalog.maps[goal.mapId]?.name}` : PLAYER_MILESTONE_LABELS[goal.milestoneId]}</span><b>{done ? '✓' : '未完成'}</b></li>; })}</ul><h3>任务奖励</h3><div className="ap-task-rewards">{!!task.reward.currency && <span>通用货币 +{task.reward.currency}</span>}{!!task.reward.warehouseSlots && <span>仓库 +{task.reward.warehouseSlots} 格</span>}{task.reward.unlockMapIds?.map(id => <span key={id}>解锁 {catalog.maps[id]?.name}</span>)}{task.reward.addPetIds?.map(id => <span key={id}>伙伴 {catalog.petTemplates[id]?.name}</span>)}</div><AdventureItems inventory={task.reward.items ?? {}} empty="" />{!taskRewardFitsWarehouse(game, task.id) && <p className="ap-warning">奖励入库空间不足，请先整理库存。</p>}</> : <div className="ap-empty"><h2>暂时没有新的任务</h2><p>继续探险，满足前置条件后会自动出现。</p></div>}</section></div><footer className="ap-footer"><span>任务自动出现，无需手动接取</span>{task && <button className="ap-primary" disabled={!taskCanComplete(game, task.id)} onClick={() => run(s => completeTask(s, task.id))}>提交任务</button>}</footer></>;
}

export function AdventurePanel({ game, now, run, onClose, intent }: { game: GameState; now: number; run: Run; onClose: () => void; intent?: { tab: 'active' | 'tasks'; key: number; expeditionId?: string } }) {
  const [view, setView] = useUIState<View>('action-view', { tab: 'explore', screen: game.expeditions.length ? 'overview' : 'prepare', step: 0, mapId: game.unlockedMapIds[0] ?? '', petIds: [], cargo: {}, expeditionId: '', reportId: '' }, isView);
  const [eventSnapshot, setEventSnapshot] = useState<Expedition>();
  const [entryMap, setEntryMap] = useUIState('action-entry-map', '', (v): v is string => typeof v === 'string');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sorted, setSorted] = useState(false);
  const [message, setMessage] = useState('');
  const update = (patch: Partial<View>) => setView(v => ({ ...v, ...patch }));
  useEffect(() => { if (intent) setView(v => ({ ...v, tab: intent.tab === 'tasks' ? 'tasks' : 'explore', screen: intent.tab === 'active' ? 'expedition' : v.screen, expeditionId: intent.expeditionId ?? game.expeditions.find(e => e.phase !== 'traveling')?.id ?? v.expeditionId })); }, [intent, setView]);
  const busy = new Set(game.expeditions.flatMap(e => e.petIds));
  const pets = view.petIds.filter(id => game.pets[id] && !busy.has(id) && game.pets[id].injury !== 'incapacitated');
  const mapId = catalog.maps[view.mapId] ? view.mapId : game.unlockedMapIds[0];
  const cargo = Object.fromEntries(Object.entries(view.cargo).filter(([id, q]) => !!catalog.items[id] && q > 0 && (game.inventory[id] ?? 0) >= q));
  const selectionStale = pets.length !== view.petIds.length || JSON.stringify(cargo) !== JSON.stringify(view.cargo);
  useEffect(() => { if (selectionStale) { setView(v => ({ ...v, petIds: pets, cargo })); setMessage('部分伙伴或携带物品已不可用，已从出发草稿移除。'); } }, [selectionStale, JSON.stringify(pets), JSON.stringify(cargo), setView]);
  const preview = useMemo(() => {
    try { const state = startExpedition(game, { mapId, petIds: pets, cargo }, 0); return { expedition: state.expeditions.at(-1)!, error: '' }; }
    catch (e) { return { error: e instanceof Error ? e.message : '无法出发' }; }
  }, [game, mapId, JSON.stringify(pets), JSON.stringify(cargo)]);
  // 仅供容量展示，不模拟奖励或随机事件。
  const previewExpedition = preview.expedition ?? { petIds: pets, cargo } as Expedition;
  const ended = game.settlements.find(s => s.expeditionId === view.expeditionId);
  const expedition = game.expeditions.find(e => e.id === view.expeditionId) ?? (eventSnapshot?.id === view.expeditionId && ended?.lastResolution ? {...eventSnapshot,phase:'extraction' as const,currentEventId:undefined,lastResolution:ended.lastResolution} : undefined);
  const report = game.settlements.find(s => s.id === view.reportId) ?? (!expedition && view.screen === 'expedition' ? game.settlements.find(s => s.expeditionId === view.expeditionId) : undefined);
  const screen = view.screen === 'expedition' && !expedition ? report ? 'report' : 'overview' : view.screen === 'report' && !report ? 'overview' : view.screen;
  const taskCount = Object.values(catalog.tasks).filter(t => taskIsAvailable(game, t.id) && taskCanComplete(game, t.id)).length;
  const goReport = (s: Settlement) => update({ screen: 'report', reportId: s.id });
  const start = () => {
    let id = '';
    if (run(state => { const next = startExpedition(state, { mapId, petIds: pets, cargo }); id = next.expeditions.at(-1)!.id; return next; })) {
      update({ screen: 'expedition', expeditionId: id, petIds: [], cargo: {}, step: 0 }); setMessage('');
    }
  };
  const allMaps = Object.values(catalog.maps), firstLockedMap = allMaps.find(m => !game.unlockedMapIds.includes(m.id));
  const availableMaps = [...allMaps.filter(m => game.unlockedMapIds.includes(m.id)), ...(firstLockedMap ? [firstLockedMap] : [])];
  const mapIndex = Math.max(0, availableMaps.findIndex(m => m.id === mapId));
  const mapDots = <div className="ap-map-dots" aria-label={`地图 ${mapIndex + 1} / ${availableMaps.length}`}>{availableMaps.map((m, i) => <i key={m.id} className={i === mapIndex ? 'on' : ''} />)}</div>;
  const inv = subtract(game.inventory, cargo);
  const tags = [...new Set(Object.keys(inv).flatMap(id => catalog.items[id]?.tags ?? []))];
  const filteredInventory = Object.fromEntries(Object.entries(inv).filter(([id]) => (filter === 'all' || catalog.items[id].tags?.includes(filter)) && catalog.items[id].name.includes(search.trim())).sort((a,b) => sorted ? (catalog.items[b[0]].sellValue ?? 0) - (catalog.items[a[0]].sellValue ?? 0) : 0));
  const cargoRoom = (id: string) => { const stack = itemStackSize(id), held = cargo[id] ?? 0; return (held % stack ? stack - held % stack : 0) + Math.max(0,cargoSlotCapacity(game,previewExpedition)-inventorySlots(cargo))*stack; };
  const moveCargo = (id: string, q: number, add: boolean) => {
    const available = add ? (game.inventory[id] ?? 0) - (cargo[id] ?? 0) : cargo[id] ?? 0;
    const next = changeQuantity(cargo, id, Math.min(q, available) * (add ? 1 : -1));
    if (add && inventorySlots(next) > cargoSlotCapacity(game, previewExpedition)) { setMessage('背包格子不足，请减少携带数量。'); return; }
    update({ cargo: next }); setMessage('');
  };
  return <div className="adventure-panel" data-testid="adventure-panel">
    <header className="ap-header"><h1 id="window-title-adventure">{view.tab === 'tasks' || screen === 'overview' || (screen === 'prepare' && view.step === 0) ? '行动' : '探险'}</h1>{(view.tab === 'tasks' || screen === 'overview' || (screen === 'prepare' && view.step === 0)) && <div className="ap-tabs" role="tablist"><button role="tab" aria-selected={view.tab === 'explore'} onClick={() => update({ tab: 'explore' })}>探险</button><button role="tab" aria-selected={view.tab === 'tasks'} onClick={() => update({ tab: 'tasks' })}>任务{taskCount ? ` · ${taskCount}` : ''}</button></div>}{view.tab === 'explore' && screen === 'prepare' && <nav className="ap-steps" aria-label="出发准备">{steps.map((label,i) => <span key={label} aria-label={label} aria-current={i === view.step ? 'step' : undefined} className={i === view.step ? 'current' : i < view.step ? 'done' : ''} />)}</nav>}<button className="ap-overview" onClick={() => update({ screen: 'overview', tab: 'explore' })}>队伍概览{game.expeditions.length ? ` · ${game.expeditions.length}` : ''}</button><button className="ap-close" aria-label="关闭行动" onClick={onClose}>×</button></header>
    {view.tab === 'tasks' ? <TaskView game={game} run={run} /> : screen === 'expedition' && expedition ? <ExpeditionView key={expedition.id} game={game} expedition={expedition} now={now} run={run} onFinished={goReport} onDeciding={setEventSnapshot} /> : screen === 'report' && report ? <><div className="ap-body ap-report"><div className="ap-report-heading"><h2>{report.outcome === 'success' ? '冒险成功' : '队伍溃败'}</h2><p>{report.petIds.map(id => game.pets[id]?.name ?? id).join('、')} · 每只伙伴获得 {report.xpAward} 经验</p></div>{report.outcome === 'success' ? <><div className="ap-sec-h">入库战利品</div><AdventureItems inventory={report.cargo} rows metric="value" empty="（没有入库物品）" />{!!Object.keys(report.firstExtractionRewards ?? {}).length && <><div className="ap-sec-h">首次撤离奖励</div><AdventureItems inventory={report.firstExtractionRewards!} rows metric="value" /></>}</> : <p className="ap-description">{report.lastResolution?.summary ?? report.summary}</p>}<div className="ap-report-rows"><div><span>入库战利品价值</span><b>{saleValue(report.cargo)+saleValue(report.firstExtractionRewards??{})}</b></div><div><span>就地售卖所得</span><b>{report.saleRevenue ?? 0}</b></div><div className="total"><span>总计收益</span><b>{saleValue(report.cargo)+saleValue(report.firstExtractionRewards??{})+(report.saleRevenue??0)}</b></div><div><span>每只伙伴经验</span><b>+{report.xpAward}</b></div><div><span>伤势</span><b>{report.petIds.map(id => game.pets[id] ? `${game.pets[id].name} · ${INJURY_LABELS[game.pets[id].injury]}` : id).join('、')}</b></div></div></div><footer className="ap-footer"><span>结果已结算，关闭不会影响奖励</span><button className="ap-primary" onClick={() => { if (run(s => dismissSettlement(s, report.id))) update({ screen: 'overview', reportId: '' }); }}>关闭战报</button></footer></> : screen === 'overview' ? <><div className="ap-body"><div className="ap-section-heading"><div><h2>伙伴的旅程</h2><p>查看在外队伍，或组织下一次探险。</p></div></div><div className="ap-team-list">{game.expeditions.map(e => <button key={e.id} onClick={() => update({ screen: 'expedition', expeditionId: e.id })}><span><strong>{e.petIds.map(id => game.pets[id]?.name).join('、')}</strong><small>{catalog.maps[e.mapId]?.name} · {catalog.maps[e.mapId]?.nodes[e.currentNodeId ?? e.targetNodeId]?.name}</small></span><em>{e.phase === 'traveling' ? `行进中 · ${timeLabel(e.arriveAt - now)}` : `${e.pendingLoot!==undefined?'拾取战利品':phaseNames[e.phase]} →`}</em></button>)}</div>{!game.expeditions.length && <div className="ap-empty"><span>⚑</span><h3>当前没有在外探险的队伍</h3><p>选好伙伴，开始新的旅程。</p></div>}{!!game.settlements.length && <><h3>最近战报</h3><div className="ap-team-list">{game.settlements.map(s => <button key={s.id} onClick={() => goReport(s)}><span>{s.petIds.map(id => game.pets[id]?.name).join('、')} · {s.outcome === 'success' ? '成功撤离' : '溃败'}</span><em>查看 →</em></button>)}</div></>}</div><footer className="ap-footer"><span>每支队伍最多 {MAX_TEAM_PETS} 名伙伴</span><button className="ap-primary" onClick={() => update({ screen: 'prepare' })}>准备出发</button></footer></> : <>
      <div className={`ap-body ap-prepare ap-prepare-${view.step}`}>
        {view.step === 0 ? <><div className="ap-sec-h">选择要派遣的宠物</div><div className="ap-pet-grid">{Object.values(game.pets).map(pet => {
          const selected = pets.includes(pet.id), disabled = busy.has(pet.id) || pet.injury === 'incapacitated' || (!selected && pets.length >= MAX_TEAM_PETS), stats = petEffectiveStats(pet);
          return <button key={pet.id} className="ap-pet-card" aria-pressed={selected} disabled={disabled} onClick={() => update({ petIds: selected ? pets.filter(id => id !== pet.id) : [...pets, pet.id] })}><div className="ap-pet-art">{pet.id === 'gugugaga' ? <PetPortrait /> : <span>◇</span>}</div><div className="ap-pet-info"><h3>{pet.name}<small>Lv.{pet.level}</small></h3><div className="ap-pet-stats">{Object.entries(stats).map(([k, n]) => <span key={k}>{STAT_LABELS[k as StatKey]} <b>{n}</b></span>)}</div><div className="ap-pet-secondary">{Object.keys(SECONDARY_STAT_LABELS).map(k => <span key={k}>{SECONDARY_STAT_LABELS[k as SecondaryStatKey]} {petSecondaryStat(pet, k as SecondaryStatKey)}</span>)}</div><p className={pet.injury === 'healthy' && !busy.has(pet.id) ? 'ap-ok' : ''}>{busy.has(pet.id) ? '探险中' : pet.injury === 'healthy' ? '状态良好' : INJURY_LABELS[pet.injury]}</p><p>负重 <b>{cargoCapacity(game,{petIds:[pet.id]} as Expedition)}</b>　容量 <b>{cargoSlotCapacity(game,{petIds:[pet.id]} as Expedition)}</b> 格</p>{!!petTags(pet).length && <p className="ap-pet-tags">{petTags(pet).map(id => catalog.tags[id]?.name ?? id).join(' · ')}</p>}</div><i>{selected ? '✓' : ''}</i></button>;
        })}</div></> : view.step === 1 ? <div className="ap-carousel">
          <button className="ap-carousel-arrow" aria-label="上一张地图" disabled={mapIndex === 0} onClick={() => {update({mapId:availableMaps[mapIndex-1].id});setEntryMap('');}}><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
          <AdventureMap key={mapId} game={game} mapId={mapId} petIds={pets} dots={mapDots} />
          <button className="ap-carousel-arrow" aria-label="下一张地图" disabled={mapIndex === availableMaps.length-1} onClick={() => {update({mapId:availableMaps[mapIndex+1].id});setEntryMap('');}}><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
        </div> : view.step === 2 ? <div className="ap-carousel ap-entry-carousel"><span className="ap-carousel-spacer"/><AdventureMap key={mapId} game={game} mapId={mapId} petIds={pets} picking picked={entryMap === mapId} onPick={() => setEntryMap(mapId)}/><span className="ap-carousel-spacer"/></div> : <div className="ap-transfer ap-loadout">
          <section><h3>库存 <span>{inventorySlots(inv)} / {game.warehouseSlots} 格</span></h3><div className="ap-loadout-tools"><input type="search" aria-label="搜索物品名称" placeholder="搜索物品名称" value={search} onChange={e => setSearch(e.target.value)}/><button onClick={() => setSorted(true)}>整理</button></div><div className="ap-loadout-filter">{['all',...tags].map(tag => <button key={tag} aria-pressed={filter === tag} onClick={() => setFilter(tag)}>{tag === 'all' ? '全部' : itemTagLabel(tag)}</button>)}</div><AdventureItems inventory={filteredInventory} slots={game.warehouseSlots} onPick={(id,q) => moveCargo(id,q,true)} room={cargoRoom}/></section>
          <section className="ap-bag-col"><h3>探险背包 <span>{inventorySlots(cargo)} / {cargoSlotCapacity(game,previewExpedition)} 格</span></h3><div className="ap-loadout-tools"><div className={`ap-weight${inventoryWeight(cargo) > cargoCapacity(game,previewExpedition) ? ' over' : ''}`}><span>负重</span><i><b style={{width:`${Math.min(100,inventoryWeight(cargo)/Math.max(1,cargoCapacity(game,previewExpedition))*100)}%`}}/></i><span>{inventoryWeight(cargo)} / {cargoCapacity(game,previewExpedition)}</span></div><button onClick={() => update({cargo:Object.fromEntries(Object.entries(cargo).sort(([a],[b]) => (catalog.items[b].sellValue??0)-(catalog.items[a].sellValue??0)))})}>整理</button></div><AdventureItems inventory={cargo} slots={cargoSlotCapacity(game,previewExpedition)} onPick={(id,q) => moveCargo(id,q,false)}/></section>
        </div>}
        {message && <p className="ap-warning" role="status">{message}</p>}{view.step === 3 && preview.error && <p className="ap-warning">{preview.error}</p>}
      </div><footer className="ap-footer"><span>{message || (view.step === 0 ? pets.length ? `已选择 ${pets.length} / ${MAX_TEAM_PETS} 只宠物` : '请选择至少一只宠物' : view.step === 3 ? preview.error || (inventoryWeight(cargo) > cargoCapacity(game,previewExpedition) ? `超载，事件风险 +${overloadPenalty(inventoryWeight(cargo)/Math.max(1,cargoCapacity(game,previewExpedition)))}` : '左键移动单个物品　右键移动整格堆叠物品') : '')}</span>{view.step > 0 && <button onClick={() => update({ step: view.step - 1 })}>上一步</button>}<button className="ap-primary" disabled={!pets.length || (view.step >= 1 && !game.unlockedMapIds.includes(mapId)) || (view.step === 2 && entryMap !== mapId) || (view.step === 3 && !!preview.error)} onClick={() => view.step < 3 ? update({ step: view.step + 1 }) : start()}>{['选择探险地图','选择起始点','行前整备','开始探索'][view.step]}</button></footer>
    </>}
  </div>;
}
