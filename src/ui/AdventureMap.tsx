import { useState, type ReactNode } from 'react';
import { catalog } from '../domain/catalog';
import { mapInformationTier, nodeLootMaximumRarity } from '../domain/engine';
import { RARITY_LABELS } from '../domain/rarity';
import type { GameState } from '../domain/types';
import mapOneArt from '../../assets/maps/mat-white-hn-2.png';
import lockedArt from '../../assets/maps/mat-white-lock-2.png';
import { knownMapGraph, routeHint, timeLabel } from './adventureModel';
import { lootIconUrl } from './lootIcons';

const illustratedPositions: Record<string, { x: number; y: number }> = {
  'm1-start': { x: 49.6, y: 78 }, 'm1-point-1': { x: 27, y: 53 },
  'm1-point-2': { x: 70.5, y: 54 }, 'm1-goal-1': { x: 49.3, y: 26 },
};
const kinds = { start: '起始点', normal: '普通节点', exit: '可撤离节点', goal: '终点' };
function NodeShape({ kind }: { kind: keyof typeof kinds }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{kind === 'start' ? <><circle cx="12" cy="12" r="9.5" fill="var(--ap-panel)" stroke="currentColor" strokeWidth="2.2" /><circle cx="12" cy="12" r="4" fill="currentColor" /></> : kind === 'goal' ? <path d="M12 3.4 L20.6 12 L12 20.6 L3.4 12 Z" fill="currentColor" stroke="var(--ap-panel)" strokeWidth="2" strokeLinejoin="round" /> : <>{kind === 'exit' && <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2.6" />}<circle cx="12" cy="12" r={kind === 'exit' ? 6.5 : 7.5} fill="currentColor" stroke="var(--ap-panel)" strokeWidth="2" /></>}</svg>;
}
export function AdventureMap({ game, mapId, petIds, currentNodeId, picking = false, picked = false, onPick, dots }: {
  game: GameState; mapId: string; petIds: string[]; currentNodeId?: string;
  picking?: boolean; picked?: boolean; onPick?: () => void; dots?: ReactNode;
}) {
  const [focus, setFocus] = useState<string>();
  const map = catalog.maps[mapId];
  if (!map) return null;
  const locked = !game.unlockedMapIds.includes(mapId);
  const graph = knownMapGraph(game, map);
  const illustrated = map.startNodeId === 'm1-start' && graph.ids.every(id => illustratedPositions[id]);
  const positions = illustrated ? illustratedPositions : graph.positions;
  const tier = mapInformationTier(game, mapId, petIds);
  const kindOf = (id: string) => id === map.startNodeId ? 'start' : map.nodes[id].terminal ? 'goal' : map.nodes[id].extractable ? 'exit' : 'normal';
  const side = (x: number, y: number) => `${y < 38 ? ' tip-down' : ''}${x < 24 ? ' tip-left' : x > 76 ? ' tip-right' : ''}`;
  return <div className="ap-map-preview">
    <div className="ap-map-title">{locked ? '？？？' : map.name}</div>
    <div className="ap-map-desc">{locked ? '完成任务后解锁下一张地图。' : picking ? '在地图上点选出发的入口。这张图只有一个入口。' : map.description}</div>
    <div className={`ap-map${illustrated ? ' illustrated' : ''}${picking ? ' picking' : ''}${locked ? ' locked' : ''}`}>
      {(illustrated || locked) && <div className="ap-map-clip"><img src={locked ? lockedArt : mapOneArt} alt="" draggable={false} /></div>}
      {!locked && <>
        <svg className="ap-map-edges" viewBox="0 0 160 90" aria-hidden="true">{graph.edges.map(({ from, edge }) => {
          const a = positions[from], b = positions[edge.toNodeId], dx = (b.x - a.x) * 1.6, dy = (b.y - a.y) * .9, length = Math.hypot(dx, dy);
          const ux = dx / length, uy = dy / length, x1 = a.x * 1.6 + ux * 4.2, y1 = a.y * .9 + uy * 4.2, x2 = b.x * 1.6 - ux * 4.2, y2 = b.y * .9 - uy * 4.2;
          const key = `${from}:${edge.id}`;
          return <g key={key} className={`ap-edge${edge.requirement ? ' gated' : ''}${focus === key ? ' hot' : ''}`} onMouseEnter={() => setFocus(key)} onMouseLeave={() => setFocus(undefined)}>
            <path className="line" d={`M${x1} ${y1}L${x2} ${y2}`} /><path className="head" d="M-2.6 -2.6 L1 0 L-2.6 2.6" transform={`translate(${x2} ${y2}) rotate(${Math.atan2(dy, dx) * 180 / Math.PI})`} />
            <path className="hit" d={`M${x1} ${y1}L${x2} ${y2}`} />
          </g>;
        })}</svg>
        {graph.ids.map(id => {
          const node = map.nodes[id], p = positions[id], start = id === map.startNodeId, rarity = nodeLootMaximumRarity(node.loot), kind = kindOf(id);
          return <div key={id} className={`ap-map-anchor${side(p.x, p.y)}${picking && start ? ' pickable' : ''}${picking && start && picked ? ' picked' : ''}${currentNodeId === id ? ' current' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
            <button className="ap-map-node" aria-label={node.name} aria-pressed={picking && start ? picked : undefined} onClick={() => { if (picking && start) onPick?.(); setFocus(id); }} onMouseEnter={() => setFocus(id)} onMouseLeave={() => setFocus(undefined)} onFocus={() => setFocus(id)} onBlur={() => setFocus(undefined)}><NodeShape kind={kind} /></button>
            {focus === id && <div className="ap-map-tip" role="tooltip"><code>{id}</code><strong>{node.name}</strong><p>{kinds[kind]}</p>
              {!start && <><p>战利品　{tier === 3 ? node.loot ? `${node.loot.minCount === node.loot.maxCount ? node.loot.minCount : `${node.loot.minCount}~${node.loot.maxCount}`} 件` : '无' : '未知'}</p><p>最高稀有度　{tier === 3 ? rarity ? RARITY_LABELS[rarity] : '无' : '未知'}</p></>}
              <p>随机事件　{start ? '无' : tier === 1 ? '未知' : node.eventPoolIds?.length ? '有' : '无'}</p>
              {kind === 'goal' && <p className="ap-map-flag">抵达后准备撤离</p>}{kind === 'exit' && <p className="ap-map-flag">可在此处撤离</p>}
              {tier === 3 && !start && Object.keys(node.firstExtractionRewards ?? {}).length > 0 && <div className="ap-map-first"><b>首次成功撤离奖励{game.completedExtractionNodeKeys?.includes(`${mapId}:${id}`) ? '（已领取）' : ''}</b>{Object.entries(node.firstExtractionRewards ?? {}).map(([itemId, q]) => <p key={itemId}><img src={lootIconUrl(itemId)} alt="" />{catalog.items[itemId]?.name} ×{q}</p>)}</div>}
            </div>}
          </div>;
        })}
        {graph.edges.map(({ from, edge }) => {
          const a = positions[from], b = positions[edge.toNodeId], key = `${from}:${edge.id}`, x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
          return <div key={key} className={`ap-map-edge-tip${side(x, y)}`} style={{ left: `${x}%`, top: `${y}%` }}><button aria-label={edge.label} onFocus={() => setFocus(key)} onBlur={() => setFocus(undefined)} onMouseEnter={() => setFocus(key)} onMouseLeave={() => setFocus(undefined)} />{focus === key && <div className="ap-map-tip" role="tooltip"><code>{edge.id}</code><strong>{edge.label}</strong><p>行进耗时　{tier === 1 ? '未知' : timeLabel(edge.durationMs)}</p>{routeHint(game, petIds, edge, tier) && <p>{routeHint(game, petIds, edge, tier)}</p>}</div>}</div>;
        })}
      </>}
    </div>
    {dots}
    {!locked && <div className="ap-map-legend">{picking ? <span>{picked ? `已选择入口：${map.nodes[map.startNodeId].name} · 整备 ${timeLabel(map.startDurationMs)} 后出发` : '点击地图上闪烁的入口'}</span> : <><span className="ap-intel">{['', '情报缺失', '部分情报', '完整情报'][tier]}</span><span>｜</span>{(Object.keys(kinds) as (keyof typeof kinds)[]).filter(k => graph.ids.some(id => kindOf(id) === k)).map(k => <span key={k}><NodeShape kind={k} />{kinds[k]}</span>)}</>}</div>}
  </div>;
}
