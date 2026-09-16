import { useRef, useState } from 'react';
import { catalog } from '../domain/catalog';
import { SECONDARY_STAT_KEYS, SECONDARY_STAT_LABELS, STAT_LABELS } from '../domain/engine';
import { itemTagLabel } from '../domain/itemTags';
import { RARITY_LABELS, rarityRank, type Rarity } from '../domain/rarity';
import type { GameState, StatKey } from '../domain/types';
import { codexGroups, codexItemCount } from './codexGroups';
import { lootIconUrl } from './lootIcons';
import { useUIState } from './uiState';
import './simplePanels.css';
import { PetPortrait } from './PetPortrait';

const COLORS: Record<Rarity, string> = { common:'#e3e3e3', uncommon:'#a8dc82', rare:'#74b9f0', epic:'#b98bee', legendary:'#f3c63c', mythic:'#f08a86' };
export function CodexPanel({ game, onClose }: { game: GameState; onClose: () => void }) {
  const [tab, setTab] = useUIState<'item' | 'pet'>('codex-tab', 'item', (v): v is 'item' | 'pet' => v === 'item' || v === 'pet');
  const [tip, setTip] = useState<{id:string;x:number;y:number} | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const groups = codexGroups(Object.values(catalog.items), game);
  const item = tip && catalog.items[tip.id], count = item ? codexItemCount(game, item.id) : 0;
  const show = (id: string, element: HTMLElement) => {
    const r = element.getBoundingClientRect(), host = root.current!.getBoundingClientRect();
    setTip({id, x:Math.max(8,Math.min(r.left-host.left,host.width-282)), y:Math.max(54, Math.min(r.bottom-host.top+6,host.height-254))});
  };
  return <div className="simple-panel codex-panel" ref={root} onKeyDown={e => { if(e.key === 'Escape' && tip) { e.stopPropagation(); setTip(null); } }}>
    <header className="sp-header"><h1 id="window-title-codex">图鉴</h1><nav className="sp-tabs" aria-label="图鉴分类">
      <button aria-pressed={tab === 'item'} onClick={() => {setTab('item');setTip(null);}}>物品</button>
      <button aria-pressed={tab === 'pet'} onClick={() => {setTab('pet');setTip(null);}}>宠物</button>
    </nav><button className="sp-close" aria-label="关闭图鉴" onClick={onClose}>×</button></header>
    <div className="sp-content cd-content" onScroll={() => setTip(null)} onClick={e => { if (!(e.target as Element).closest('.cd-cell')) setTip(null); }}>
      {tab === 'item' ? groups.map(group => <section className="cd-group" key={group.id} data-group={group.id}>
        <h2>{group.label}</h2><div className="cd-grid">{group.items.map(entry => {
          const acquired = codexItemCount(game,entry.id), known = acquired > 0, url = lootIconUrl(entry.id);
          return <button className={`cd-cell${known ? '' : ' unknown'}`} key={entry.id} data-item-id={entry.id}
            aria-label={known ? `${entry.name}，累计获得 ${acquired} 件` : '？？？，未获得物品'}
            aria-describedby={tip?.id === entry.id ? 'codex-item-tip' : undefined}
            style={known ? {background:COLORS[entry.rarity]} : undefined}
            onMouseEnter={e => show(entry.id,e.currentTarget)} onFocus={e => show(entry.id,e.currentTarget)} onClick={e => show(entry.id,e.currentTarget)}>
            {url ? <img src={url} alt="" draggable={false} /> : <span aria-hidden="true">◇</span>}
          </button>;
        })}</div>
      </section>) : <div className="cd-pet-grid">{Object.values(catalog.petTemplates).map(pet => {
        const known = Object.hasOwn(game.pets,pet.id);
        return <article className={`cd-pet${known ? '' : ' unknown'}`} key={pet.id}>
          {pet.id === 'gugugaga' ? <PetPortrait known={known} /> : <div className="cd-pet-placeholder" aria-hidden="true">◇</div>}
          <div className="cd-pet-info"><h2>{known ? pet.name : '？？？'}</h2>
            {known ? <><div className="cd-pet-stats">{(['fitness','perception','technique'] as StatKey[]).map(stat => <span key={stat}>{STAT_LABELS[stat]} <b>{pet.baseStats[stat]}</b></span>)}</div>
              <div className="cd-pet-stats cd-pet-secondary">{SECONDARY_STAT_KEYS.map(stat => <span key={stat}>{SECONDARY_STAT_LABELS[stat]} <b>{pet.secondaryStats[stat]}</b></span>)}</div>
              <p className={`cd-innate${pet.innateTagId ? '' : ' empty'}`}>初始特质：{pet.innateTagId ? catalog.tags[pet.innateTagId]?.name ?? pet.innateTagId : '无'}</p></> : <p className="sp-muted">尚未结识</p>}
          </div>
        </article>;
      })}</div>}
      {tab === 'item' && !groups.length && <p className="sp-empty">冒险中的发现会记录在这里。</p>}
    </div>
    <footer className="sp-footer">{tab === 'item' ? '悬停或点击物品查看详情 · 累计获得件数不会因出售或使用减少' : '展示伙伴的初始属性，当前属性请查看状态面板'}</footer>
    {tab === 'item' && tip && item && <aside className="cd-tip" id="codex-item-tip" role="tooltip" style={{left:tip.x,top:tip.y}}>
      <strong>{count > 0 ? item.name : '？？？'}</strong>
      {count > 0 && <><span className="cd-rarity" style={{background:COLORS[item.rarity]}}>{RARITY_LABELS[item.rarity]}</span>
        {item.description && rarityRank(item.rarity) >= rarityRank('legendary') && <p className="cd-description">{item.description}</p>}
        <div className="cd-tags">{item.tags?.map(tag => <span key={tag}>{itemTagLabel(tag)}</span>)}</div>
        <p>累计获得 <b>{count}</b> 件</p><p className="sp-muted">单重 {item.weight} · {item.sellable ? `售价 ${item.sellValue ?? 0}` : '不可出售'}</p></>}
    </aside>}
  </div>;
}
