import { useState, type CSSProperties } from 'react';
import { catalog } from '../domain/catalog';
import { itemTagLabel } from '../domain/itemTags';
import { RARITY_LABELS } from '../domain/rarity';
import type { Inventory } from '../domain/types';
import { inventoryCells } from './inventoryPanelModel';
import { ItemTooltip } from './ItemTooltip';
import { lootIconUrl } from './lootIcons';
import coinIcon from '../../assets/ui-prototype/icons/coin.png';

const colors = { common: '#e3e3e3', uncommon: '#a8dc82', rare: '#74b9f0', epic: '#b98bee', legendary: '#f3c63c', mythic: '#f08a86' };
export function AdventureItems({ inventory, empty = '暂无物品', onPick, movable, slots = 0, room, rows = false, metric = 'weight' }: {
  inventory: Inventory; empty?: string; onPick?: (id: string, quantity: number, cellIndex: number) => void; movable?: Inventory; slots?: number;
  room?: (id: string) => number; rows?: boolean; metric?: 'weight' | 'value';
}) {
  const [tip, setTip] = useState<{id:string;quantity:number;x:number;y:number}>();
  const cells = inventoryCells(Object.entries(inventory).filter(([, q]) => q > 0));
  if (rows) return <div className="ap-item-rows">{Object.entries(inventory).filter(([, q]) => q > 0).map(([id,q]) => <div className="ap-item-row" key={id}><span style={{background:colors[catalog.items[id].rarity]}}><img src={lootIconUrl(id)} alt="" /></span><span>{catalog.items[id].name}{q > 1 ? ` ×${q}` : ''}</span><small>{metric==='value'?<><img className="ap-coin" src={coinIcon} alt="价值"/>{(catalog.items[id].sellValue??0)*q}</>:(catalog.items[id].weight*q).toFixed(1)}</small></div>)}{!cells.length && <p className="ap-muted">{empty}</p>}</div>;
  return <div className="ap-items" aria-label="物品格子" onScroll={() => setTip(undefined)}>
    {Array.from({ length: Math.max(cells.length, Math.min(slots, 120)) }, (_, i) => {
      const c = cells[i], item = c && catalog.items[c.id], url = c && lootIconUrl(c.id);
      if (!c || !item) return <span key={i} className="ap-item empty" />;
      // 可移回量属于本轮草稿，绝不能拿走同名旧库存。
      const quantity = Math.min(c.quantity, movable ? movable[c.id] ?? 0 : c.quantity, room ? room(c.id) : Infinity);
      const title = `${item.name} ×${c.quantity}\n${RARITY_LABELS[item.rarity]} · 重量 ${item.weight} · ${item.sellable ? `单价 ${item.sellValue ?? 0}` : '不可出售'}${item.tags?.length ? `\n${item.tags.map(itemTagLabel).join(' / ')}` : ''}${onPick ? quantity ? '\n左键移 1 件，右键移一组' : '\n原有库存，不可取回' : ''}`;
      return <button key={`${c.id}-${i}`} className={`ap-item${onPick && quantity ? ' movable' : ''}${room && !quantity ? ' full' : ''}${movable && quantity ? ' fresh' : ''}${movable && !quantity ? ' old' : ''}`} style={{ '--item-color': colors[item.rarity] } as CSSProperties} aria-label={`${item.name} ×${c.quantity}`} data-description={title} aria-disabled={!!onPick && !quantity} onMouseEnter={e => { const r=e.currentTarget.getBoundingClientRect(); setTip({id:c.id,quantity:c.quantity,x:Math.max(6,Math.min(window.innerWidth-280,r.left)),y:Math.max(6,Math.min(window.innerHeight-220,r.bottom+6))}); }} onMouseLeave={() => setTip(undefined)} onFocus={e => { const r=e.currentTarget.getBoundingClientRect(); setTip({id:c.id,quantity:c.quantity,x:Math.max(6,Math.min(window.innerWidth-280,r.left)),y:Math.max(6,Math.min(window.innerHeight-220,r.bottom+6))}); }} onBlur={() => setTip(undefined)} onClick={() => {setTip(undefined); if(quantity) onPick?.(c.id, 1, c.index);}} onContextMenu={e => { e.preventDefault(); setTip(undefined); if (quantity) onPick?.(c.id, quantity, c.index); }}>
        {url ? <img src={url} alt="" draggable={false} /> : <span>◇</span>}{c.quantity>1 && <b>{c.quantity}</b>}
      </button>;
    })}
    {!cells.length && !slots && <p className="ap-muted">{empty}</p>}
    {tip && <ItemTooltip id={tip.id} quantity={tip.quantity} x={tip.x} y={tip.y} />}
  </div>;
}
