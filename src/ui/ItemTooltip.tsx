import { itemTooltipInfo } from './itemTooltipModel';
import './itemTooltip.css';

/** 物品悬浮提示。格子里只画图标和数量，其余信息（重量、售价、标签、效果、描述）都在这里。 */
export function ItemTooltip({ id, quantity = 0, x, y }: { id: string; quantity?: number; x: number; y: number }) {
  const info = itemTooltipInfo(id, quantity);
  if (!info) return null;
  return <div className="item-tip" role="tooltip" style={{ left: x, top: y }}>
    <div className="item-tip-head"><strong>{info.name}</strong><span className={`item-tip-rarity ${info.rarity}`}>{info.rarityLabel}</span></div>
    {!!info.tags.length && <p className="item-tip-tags">{info.tags.map(tag => <span key={tag}>{tag}</span>)}</p>}
    {!!info.description && <p className="item-tip-desc">{info.description}</p>}
    <dl className="item-tip-facts">{info.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
    {!!info.effects.length && <ul className="item-tip-effects">{info.effects.map(effect => <li key={effect}>{effect}</li>)}</ul>}
  </div>;
}
