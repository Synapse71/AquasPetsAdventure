import { mapEntryNodeIds } from "../domain/mapEntries";
import { START_TRAVEL_DURATION_MS } from '../domain/expeditionTiming';
import { useState, type ReactNode } from 'react';
import { catalog } from '../domain/catalog';
import { mapInformationTier, nodeLootMaximumRarity, SECONDARY_STAT_LABELS } from '../domain/engine';
import { RARITY_LABELS } from '../domain/rarity';
import type { GameState } from '../domain/types';
import lockedArt from '../../assets/maps/mat-white-lock-2.png';
import { mapArtwork, mapArtworkAnchors, mapArtworkScale } from './mapArtwork';
import locationPin from './map-location.svg';
import flagIcon from './map-flag.svg';
import exitIcon from './map-exit.svg';
import { MapViewport } from './MapViewport';
import { hasRouteRequirement, knownMapGraph, routeHint, STAT_LABELS, timeLabel } from './adventureModel';
import { lootIconUrl } from './lootIcons';

const statIcons = import.meta.glob<string>('../../assets/ui-prototype/icons/stat-*.png', { eager: true, query: '?url', import: 'default' });
const statIcon = (stat: string) => statIcons[`../../assets/ui-prototype/icons/stat-${stat}.png`];
const kinds = { start: '起点', exit: '可撤离', goal: '终点', hidden: '隐藏节点' };
type NodeKind = keyof typeof kinds | 'normal';
function NodeShape({ kind }: { kind: NodeKind }) {
  return <img className={`ap-map-node-icon ${kind}`} src={kind === 'goal' ? flagIcon : kind === 'exit' ? exitIcon : locationPin} alt="" />;
}
function Requirement({ requirement }: { requirement: NonNullable<import('../domain/types').MapEdgeDefinition['requirement']> }) {
  const [stat, value] = Object.entries(requirement.minimumStat ?? {})[0] ?? [];
  const secondary = requirement.secondary;
  const label = secondary ? SECONDARY_STAT_LABELS[secondary.stat] : stat ? STAT_LABELS[stat as keyof typeof STAT_LABELS] : undefined;
  const amount = secondary?.value ?? value;
  const icon = secondary ? statIcon(secondary.stat) : stat ? statIcon(stat) : undefined;
  return label && amount !== undefined ? <p className="ap-route-requirement">需要{icon && <img src={icon} alt="" />}{label} 至少 {amount}</p> : null;
}
export function AdventureMap({ game, mapId, petIds, currentNodeId, picking = false, pickedNodeId, onPick, dots }: {
  game: GameState; mapId: string; petIds: string[]; currentNodeId?: string;
  picking?: boolean; pickedNodeId?: string; onPick?: (nodeId: string) => void; dots?: ReactNode;
}) {
  const [focus, setFocus] = useState<string>();
  const map = catalog.maps[mapId];
  if (!map) return null;
  const entries = mapEntryNodeIds(map);
  const mapHeight = 160 / (map.aspectRatio ?? (16 / 9));
  const picked = !!pickedNodeId && entries.includes(pickedNodeId);
  const locked = !game.unlockedMapIds.includes(mapId);
  const graph = knownMapGraph(game, map);
  const artwork = mapArtwork[mapId];
  const defaultPositions = mapArtworkAnchors[mapId];
  const illustrated = !!artwork;
  const configuredPositions = map.nodePositions ?? {};
  const positions = Object.fromEntries(graph.ids.map((id) => [id, configuredPositions[id] ?? defaultPositions?.[id] ?? graph.positions[id]]));
  const tier = mapInformationTier(game, mapId, petIds);
  const hiddenNodeIds = new Set(Object.values(map.nodes).filter(node => Object.values(map.nodes).some(source => source.edges.some(edge => edge.toNodeId === node.id && edge.hidden))).map(node => node.id));
  const kindOf = (id: string): NodeKind => entries.includes(id) ? 'start' : map.nodes[id].terminal ? 'goal' : map.nodes[id].extractable ? 'exit' : hiddenNodeIds.has(id) ? 'hidden' : 'normal';
  const centerId = currentNodeId ?? (picking ? pickedNodeId ?? entries[0] : undefined);
  const side = (x: number, y: number) => `${y < 38 ? ' tip-down' : ''}${x < 24 ? ' tip-left' : x > 76 ? ' tip-right' : ''}`;
  return <div className="ap-map-preview">
    <div className="ap-map-title">{locked ? '？？？' : map.name}</div>
    <div className="ap-map-desc">{locked ? '完成任务后解锁下一张地图。' : picking ? `在地图上点选出发的入口。共 ${entries.length} 个入口。` : map.description}</div>
    <MapViewport mapId={mapId} ratio={map.aspectRatio ?? 16 / 9} center={centerId ? positions[centerId] : undefined} onPan={() => setFocus(undefined)}>
    <div className={`ap-map${illustrated ? ' illustrated' : ''}${picking ? ' picking' : ''}${locked ? ' locked' : ''}`}>
      {(illustrated || locked) && <div className="ap-map-clip"><img src={locked ? lockedArt : artwork} style={{ transform: `scale(${locked ? 1.04 : (mapArtworkScale[mapId] ?? 1.04)})` }} alt="" draggable={false} /></div>}
      {!locked && <>
        <svg className="ap-map-edges" viewBox={`0 0 160 ${mapHeight}`} aria-hidden="true">{graph.edges.map(({ from, edge }) => {
          const a = positions[from], b = positions[edge.toNodeId], dx = (b.x - a.x) * 1.6, dy = (b.y - a.y) * mapHeight / 100, length = Math.hypot(dx, dy);
          const ux = dx / length, uy = dy / length, x1 = a.x * 1.6 + ux * 5, y1 = a.y * mapHeight / 100 + uy * 5, x2 = b.x * 1.6 - ux * 5, y2 = b.y * mapHeight / 100 - uy * 5;
          const key = `${from}:${edge.id}`;
          const gated = hasRouteRequirement(edge);
          const blocked = gated && routeHint(game, petIds, edge, 3).includes('不足');
          return <g key={key} className={`ap-edge${gated ? ' gated' : ''}${blocked ? ' blocked' : ''}${focus === key ? ' hot' : ''}`} onMouseEnter={() => setFocus(key)} onMouseLeave={() => setFocus(undefined)}>
            <path className="line" d={`M${x1} ${y1}L${x2} ${y2}`} /><path className="head" d="M-1.7 -1.5 L0.7 0 L-1.7 1.5" transform={`translate(${x2} ${y2}) rotate(${Math.atan2(dy, dx) * 180 / Math.PI})`} />
            <path className="hit" d={`M${x1} ${y1}L${x2} ${y2}`} />
          </g>;
        })}</svg>
        {graph.ids.map(id => {
          const node = map.nodes[id], p = positions[id], start = entries.includes(id), rarity = nodeLootMaximumRarity(node.loot), kind = kindOf(id);
          // 选入口阶段：非起点节点与路线一样只做悬停高亮/提示，不可点击，
          // 并连同 Tooltip 一起压在灰色蒙版之下，避免看起来像是可选目标。
          const underVeil = picking && !start;
          return <div key={id} className={`ap-map-anchor${side(p.x, p.y)}${picking && start ? ' pickable' : ''}${picking && start && pickedNodeId === id ? ' picked' : ''}${currentNodeId === id ? ' current' : ''}${underVeil ? ' under-veil' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
            <button className="ap-map-node" aria-label={node.name} aria-pressed={picking && start ? pickedNodeId === id : undefined} tabIndex={underVeil ? -1 : undefined} onMouseDown={(e) => { if (underVeil) e.preventDefault(); }} onClick={() => { if (underVeil) return; if (picking && start) onPick?.(id); setFocus(id); }} onMouseEnter={() => setFocus(id)} onMouseLeave={() => setFocus(undefined)} onFocus={() => setFocus(id)} onBlur={() => setFocus(undefined)}><NodeShape kind={kind} /></button>
            {focus === id && <div className="ap-map-tip" role="tooltip"><strong>{node.name}</strong>
              {kind !== 'normal' && <p>{kinds[kind]}</p>}
              {!start && <><p>战利品　{tier === 3 ? node.loot ? `${node.loot.minCount === node.loot.maxCount ? node.loot.minCount : `${node.loot.minCount}~${node.loot.maxCount}`} 件` : '无' : '未知'}</p><p>最高稀有度　{tier === 3 && rarity ? <span className={`rarity-${rarity}`}>{RARITY_LABELS[rarity]}</span> : '未知'}</p></>}
              {!start && tier > 1 && (node.eventPoolIds?.length || node.fixedEventIds?.some(id => catalog.events[id] && (catalog.events[id].absentPetIds ?? []).every(petId => !game.pets[petId]))) ? <p className="ap-map-event">此地点有事件</p> : null}
              {kind === 'goal' && <p className="ap-map-flag">抵达后准备撤离</p>}{kind === 'exit' && <p className="ap-map-flag">可在此处撤离</p>}
              {tier === 3 && !start && Object.keys(node.firstExtractionRewards ?? {}).length > 0 && <div className="ap-map-first"><b>首次成功撤离奖励{game.completedExtractionNodeKeys?.includes(`${mapId}:${id}`) ? '（已领取）' : ''}</b>{Object.entries(node.firstExtractionRewards ?? {}).map(([itemId, q]) => <p key={itemId}><img src={lootIconUrl(itemId)} alt="" />{catalog.items[itemId]?.name} ×{q}</p>)}</div>}
            </div>}
          </div>;
        })}
        {graph.edges.map(({ from, edge }) => {
          const a = positions[from], b = positions[edge.toNodeId], key = `${from}:${edge.id}`, x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
          return <div key={key} className={`ap-map-edge-tip${side(x, y)}`} style={{ left: `${x}%`, top: `${y}%` }}><button aria-label={edge.label} onFocus={() => setFocus(key)} onBlur={() => setFocus(undefined)} onMouseEnter={() => setFocus(key)} onMouseLeave={() => setFocus(undefined)} />{focus === key && <div className="ap-map-tip" role="tooltip"><strong>{edge.label}</strong><p>行进耗时　{tier === 1 ? '未知' : timeLabel(edge.durationMs)}</p>{tier === 3 && edge.requirement && <Requirement requirement={edge.requirement} />}</div>}</div>;
        })}
      </>}
    </div>
    </MapViewport>
    {dots}
    <div className="ap-map-key"><span><img src={exitIcon} alt="" />中途撤离点</span><span><img src={flagIcon} alt="" />终点</span><span>拖拽查看地图</span></div>
    <div className="ap-map-legend">{!locked && (picking ? <span>{picked ? `已选择入口：${map.nodes[pickedNodeId!].name} · 整备 ${timeLabel(START_TRAVEL_DURATION_MS)} 后出发` : '点击地图上闪烁的入口'}</span> : <span className={`ap-intel t${tier}`}>{['', '情报缺失', '部分情报', '完整情报'][tier]}</span>)}</div>
  </div>;
}
