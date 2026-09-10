import { useEffect } from 'react';
import { catalog } from '../domain/catalog';
import {
  allocateStats, CARRY_BASE, CARRY_PER_FITNESS, GameRuleError, healPet,
  INJURY_LABELS, injuryHealCost, injuryMultiplier, maxLevel, petCarryCapacity,
  petEffectiveStats, petSecondaryStat, petSlotCapacity, petStatResetCost, petStats,
  resetPetStats, SECONDARY_STAT_KEYS, SECONDARY_STAT_LABELS, SLOTS_BASE,
  SLOTS_PER_TECHNIQUE, STAT_LABELS, xpToNextLevel,
} from '../domain/engine';
import type { GameState, StatKey } from '../domain/types';
import { emptyPoints, isStatusDrafts, pointCount, previewPet, PRIMARY_KEYS, statusDraftBasis, validStatusDraft, type PetStatusDraft, type PetStatusDrafts } from './petStatusDraft';
import { useUIState } from './uiState';
import './petStatusPanel.css';

const iconFiles = import.meta.glob<string>('../../assets/ui-prototype/icons/{stat-fitness,stat-perception,stat-technique,stat-eloquence,stat-lore,stat-courage,stat-guile,stat-injury,coin}.png', { eager: true, query: '?url', import: 'default' });
const icon = (name: string) => iconFiles[`../../assets/ui-prototype/icons/${name}.png`];
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
function Coin({ amount }: { amount: number }) {
  return <span className="ps-money"><img src={icon('coin')} alt="通用货币" />{number(amount)}</span>;
}
function remaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}时 ${Math.floor(seconds % 3600 / 60)}分`;
  return `${Math.floor(seconds / 60)}分 ${seconds % 60}秒`;
}
export function PetStatusPanel({ game, now, run, onClose, intent }: {
  game: GameState; now: number; run: (action: (state: GameState) => GameState) => boolean;
  onClose: () => void; intent?: { petId: string; key: number };
}) {
  const [selected, setSelected] = useUIState('status-pet', '', (value): value is string => typeof value === 'string');
  const [drafts, setDrafts] = useUIState<PetStatusDrafts>('status-drafts', {}, isStatusDrafts);
  const pets = Object.values(game.pets), pet = Object.hasOwn(game.pets, selected) ? game.pets[selected] : pets[0];
  useEffect(() => { if (intent) setSelected(intent.petId); }, [intent, setSelected]);
  useEffect(() => {
    const cleaned = Object.fromEntries(Object.entries(drafts).filter(([id, draft]) => Object.hasOwn(game.pets, id) && validStatusDraft(game, game.pets[id], draft)));
    if (Object.keys(cleaned).length !== Object.keys(drafts).length) setDrafts(cleaned);
  }, [game, drafts, setDrafts]);
  if (!pet) return <div className="pet-status-panel">暂无宠物。</div>;
  const draft = validStatusDraft(game, pet, drafts[pet.id]);
  const points = draft?.points ?? emptyPoints(), pending = pointCount(points);
  const askingReset = draft?.mode === 'reset';
  const preview = previewPet(pet, points), raw = petStats(preview), effective = petEffectiveStats(preview);
  const multiplier = injuryMultiplier(pet.injury), hurt = pet.injury !== 'healthy';
  const away = game.expeditions.some(e => e.petIds.includes(pet.id));
  const available = pet.unspentPoints - pending, allocated = pointCount(pet.allocatedStats);
  const cost = petStatResetCost(game), healCost = injuryHealCost(pet);
  const tags = [...(pet.innateTagId ? [{ id: pet.innateTagId, innate: true }] : []), ...pet.growthTagIds.map(id => ({ id, innate: false }))];
  const tagSlots = Math.min(2, pet.growthTagSlots + (pet.innateTagId ? 1 : 0));
  const setDraft = (next: PetStatusDraft) => setDrafts(previous => ({ ...previous, [pet.id]: next }));
  const clearDraft = () => setDrafts(previous => { const next = { ...previous }; delete next[pet.id]; return next; });
  const changePoint = (key: StatKey, delta: number) => {
    if (askingReset || (delta > 0 && available <= 0) || (delta < 0 && points[key] <= 0)) return;
    setDraft({ basis: statusDraftBasis(game, pet), mode: 'allocate', points: { ...points, [key]: points[key] + delta } });
  };
  const commit = () => {
    if (!draft || !pending) return;
    if (run(state => {
      const current = state.pets[pet.id];
      if (!current || !validStatusDraft(state, current, draft)) throw new GameRuleError('属性已变化，请重新分配。');
      return allocateStats(state, pet.id, draft.points);
    })) clearDraft();
  };
  const confirmReset = () => {
    if (!draft || !askingReset) return;
    if (run(state => {
      const current = state.pets[pet.id];
      if (!current || !validStatusDraft(state, current, draft)) throw new GameRuleError('属性或洗点费用已变化，请重新确认。');
      return resetPetStats(state, pet.id, game.statResetCount);
    })) clearDraft();
  };
  const injuryText = !hurt ? (away ? '正在冒险途中' : '状态良好，可以出发') : away ? '冒险途中，伤势恢复暂停' : pet.injuryRecoveredAt !== undefined
    ? `${remaining(pet.injuryRecoveredAt - now)}后好转为${pet.injury === 'incapacitated' ? '受伤' : '正常'}` : '在基地等待恢复';
  const carry = petCarryCapacity(preview), carryDelta = Math.round((carry - petCarryCapacity(pet)) * 10) / 10;
  const slots = petSlotCapacity(preview), slotsDelta = slots - petSlotCapacity(pet);
  return <div className="pet-status-panel" data-testid="pet-status-panel">
    <h1 className="ps-sr-only" id="window-title-pets">状态</h1>
    <header className="ps-header">
      <div className="ps-avatar" aria-hidden="true"><div style={{ backgroundImage: `url(${import.meta.env.BASE_URL}pet-sprites/blink-plain.webp)` }} /></div>
      <div className="ps-identity">
        {pets.length > 1 ? <select aria-label="选择宠物" value={pet.id} onChange={e => setSelected(e.target.value)}>{pets.map(p => <option key={p.id} value={p.id}>{p.name}{p.unspentPoints > 0 ? ' · 有待分配点数' : ''}</option>)}</select> : <h2>{pet.name}</h2>}
        <div className="ps-level">Lv.{pet.level}<span>{pet.level >= maxLevel() ? '已满级' : `${number(pet.xp)} / ${number(xpToNextLevel(pet.level))} 经验`}</span></div>
        <div className="ps-xp" role="progressbar" aria-label="升级经验" aria-valuemin={0} aria-valuemax={pet.level >= maxLevel() ? 1 : xpToNextLevel(pet.level)} aria-valuenow={pet.level >= maxLevel() ? 1 : pet.xp}><i style={{ width: `${pet.level >= maxLevel() ? 100 : Math.min(100, pet.xp / xpToNextLevel(pet.level) * 100)}%` }} /></div>
      </div>
      <span className={`ps-badge ps-${pet.injury}`}>{INJURY_LABELS[pet.injury]}</span>
      <button className="ps-close" aria-label="关闭窗口" onClick={onClose}>×</button>
    </header>
    <div className={`ps-injury ${hurt ? 'is-hurt' : ''}`}>
      {hurt && <img src={icon('stat-injury')} alt="" />}<span title={injuryText}>{injuryText}</span>
      {hurt && <button className="ps-heal" disabled={away || game.currency < healCost} title={away ? '回到基地后才能治疗' : game.currency < healCost ? '通用货币不足' : '立即完全恢复正常'} onClick={() => run(state => healPet(state, pet.id))}>治疗 <Coin amount={healCost} /></button>}
    </div>
    <div className="ps-primary-heading"><h3>主属性</h3>{hurt && <span className="ps-multiplier">伤势 ×{multiplier}</span>}<span className="ps-points"><b data-testid="available-points">{number(available)}</b> 点待分配</span>
      <button className="ps-reset" disabled={!allocated || pending > 0 || askingReset} title={pending ? '请先确认或撤销加点' : !allocated ? '没有已分配的属性点' : `本次费用 ${number(cost)}`} onClick={() => setDraft({ basis: statusDraftBasis(game, pet), mode: 'reset', points: emptyPoints() })}>重置属性点</button>
    </div>
    <div className="ps-stats">{PRIMARY_KEYS.map(key => <div className="ps-stat" key={key} data-stat={key}>
      <img src={icon(`stat-${key}`)} alt="" /><span className="ps-stat-label">{STAT_LABELS[key]}</span>
      <span className="ps-stat-numbers">{points[key] > 0 && <small className="ps-delta">+{points[key]}</small>}<strong className={hurt ? 'is-hurt' : ''} data-testid={`effective-${key}`}>{number(effective[key])}</strong>{hurt && <small>原 <s>{number(raw[key])}</s></small>}</span>
      <button className={`ps-minus ${points[key] ? '' : 'is-placeholder'}`} disabled={!points[key] || askingReset} aria-label={`撤回${STAT_LABELS[key]}一点`} onClick={() => changePoint(key, -1)}>−</button>
      <button className="ps-plus" disabled={!available || askingReset} aria-label={`给${STAT_LABELS[key]}加一点`} onClick={() => changePoint(key, 1)}>+</button>
    </div>)}</div>
    <div className={`ps-actions ${pending || askingReset ? '' : 'is-idle'}`} aria-hidden={!pending && !askingReset}>
      {askingReset ? <><div className="ps-action-copy is-hurt"><span>退回 <b>{number(allocated)}</b> 点 · {cost === 0 ? '首次免费' : <Coin amount={cost} />}</span><small>{game.currency < cost ? '通用货币不足' : '全部已分配属性清零，基础属性不变'}</small></div><button onClick={clearDraft}>取消</button><button className="ps-danger" disabled={game.currency < cost} onClick={confirmReset}>确认重置</button></> : <><div className="ps-action-copy" title={PRIMARY_KEYS.filter(k => points[k]).map(k => `${STAT_LABELS[k]} +${points[k]}`).join('，')}>本次分配 <b>{number(pending)}</b> 点<small>确认后生效</small></div><button onClick={clearDraft} disabled={!pending}>撤销</button><button className="ps-confirm" onClick={commit} disabled={!pending}>确认 {number(pending)} 点</button></>}
    </div>
    <section className="ps-section"><h3>次要属性 <small>门槛判定 · 不受伤势影响</small></h3><div className="ps-secondary">{SECONDARY_STAT_KEYS.map(key => <div key={key}><img src={icon(`stat-${key}`)} alt=""/><span>{SECONDARY_STAT_LABELS[key]}</span><strong>{number(petSecondaryStat(pet, key))}</strong></div>)}</div></section>
    <section className="ps-section"><h3>派生 <small>{pending ? '预览 · 尚未提交' : '当前属性'}</small></h3><div className="ps-derived">
      <div><span>负重上限</span><strong className={hurt ? 'is-hurt' : ''} data-testid="carry-capacity">{number(carry)}{carryDelta > 0 && <small className="ps-delta"> +{number(carryDelta)}</small>}</strong><small>({CARRY_BASE} + {number(raw.fitness)} × {CARRY_PER_FITNESS}){hurt && ` × ${multiplier}`}</small></div>
      <div><span>格子上限</span><strong data-testid="slot-capacity">{number(slots)}{slotsDelta > 0 && <small className="ps-delta"> +{number(slotsDelta)}</small>}</strong><small>{SLOTS_BASE} + {number(raw.technique)} × {SLOTS_PER_TECHNIQUE}{hurt && ' · 不受伤势影响'}</small></div>
    </div></section>
    <section className="ps-section"><h3>特质 <small>最多 {tagSlots} 个</small></h3><div className="ps-tags">
      {tags.map(tag => <div key={tag.id} title={catalog.tags[tag.id]?.description}><b>{catalog.tags[tag.id]?.name ?? '未知特质'}<small>{tag.innate ? '先天' : '成长'}</small></b><span>{catalog.tags[tag.id]?.description ?? '暂无描述'}</span></div>)}
      {Array.from({ length: Math.max(0, tagSlots - tags.length) }, (_, i) => <div className="ps-empty-tag" key={`empty-${i}`}><span>空槽</span><small>使用稀有成长道具赋予特质</small></div>)}
    </div></section>
  </div>;
}
