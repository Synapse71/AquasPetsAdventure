import { catalog } from '../domain/catalog';
import { GameRuleError, SECONDARY_STAT_LABELS, isRouteDiscovered, teamSecondaryStat, teamStatForPets } from '../domain/engine';
import type { ExtractionPlan } from '../domain/engine';
import type { GameState, Inventory, MapDefinition, MapEdgeDefinition, StatKey } from '../domain/types';

export const STAT_LABELS: Record<StatKey, string> = { fitness: '体能', perception: '感知', technique: '技巧' };
export const OUTCOMES = { 'extra-success': '大成功', success: '成功', failure: '失败', 'big-failure': '大失败', leave: '已离开' };
/** 解锁由引擎按时间追加；跳过已从目录移除的地图，不选择尚未解锁的地图。 */
export function latestUnlockedMapId(unlockedMapIds: readonly string[], maps: Record<string, MapDefinition> = catalog.maps): string {
  for (let i = unlockedMapIds.length - 1; i >= 0; i--) {
    if (Object.hasOwn(maps, unlockedMapIds[i])) return unlockedMapIds[i];
  }
  return '';
}
export const timeLabel = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}小时${Math.ceil(s % 3600 / 60)}分` : s >= 60 ? `${Math.floor(s / 60)}分${s % 60 ? `${s % 60}秒` : ''}` : `${s}秒`; };
export const isInventory = (v: unknown): v is Inventory => !!v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([id, q]) => !!catalog.items[id] && Number.isSafeInteger(q) && (q as number) > 0);
export function subtract(source: Inventory, used: Inventory): Inventory {
  return Object.fromEntries(Object.entries(source).map(([id, q]) => [id, Math.max(0, q - (used[id] ?? 0))]).filter(([, q]) => Number(q) > 0));
}
export function changeQuantity(source: Inventory, id: string, delta: number): Inventory {
  const next = { ...source, [id]: Math.max(0, (source[id] ?? 0) + delta) };
  if (!next[id]) delete next[id];
  return next;
}
export function extractionPlan(cargo: Inventory, keep: Inventory, discard: Inventory): ExtractionPlan {
  for (const [id, q] of Object.entries({ ...keep, ...discard })) {
    if (!Number.isSafeInteger(q) || q <= 0 || (keep[id] ?? 0) + (discard[id] ?? 0) > (cargo[id] ?? 0)) throw new GameRuleError('撤离草稿已失效，请重新整理。');
  }
  return { keep, discard, sell: subtract(subtract(cargo, keep), discard) };
}
export function extractionBasis(game: GameState, expeditionId: string): string {
  const e = game.expeditions.find(e => e.id === expeditionId);
  return JSON.stringify([e?.phase, e?.cargo, e?.initialCargo, e?.soldDuringExtraction, game.inventory, game.warehouseSlots,
    game.completedExtractionNodeKeys, e?.petIds.map(id => game.pets[id]), catalog.items, e && catalog.maps[e.mapId]]);
}
export function routeHint(game: GameState, pets: string[], edge: MapEdgeDefinition, tier: 1 | 2 | 3): string {
  const req = edge.requirement;
  if (!req) return '';
  if (req.tagId && !pets.some(id => { const p = game.pets[id]; return p?.innateTagId === req.tagId || p?.growthTagIds.includes(req.tagId!); })) return `需要特质「${catalog.tags[req.tagId]?.name ?? req.tagId}」`;
  const gates = Object.entries(req.minimumStat ?? {}).map(([s, value]) => ({ label: STAT_LABELS[s as StatKey], value: value!, current: teamStatForPets(game, pets, s as StatKey) }));
  if (req.secondary) gates.push({ label: SECONDARY_STAT_LABELS[req.secondary.stat], value: req.secondary.value, current: teamSecondaryStat(game, pets, req.secondary.stat) });
  if (tier === 3) return gates.map(g => `${g.label} ≥ ${g.value}${g.current < g.value ? '（不足）' : ''}`).join('；');
  const failed = gates.filter(g => g.current < g.value);
  return failed.length ? tier === 1 ? '某项属性不足' : `${failed.map(g => g.label).join('、')}不足` : '';
}
/** 预览只包含普通路线和真正走过的隐藏路线，不受当前特质/情报档位影响。 */
export function knownMapGraph(game: GameState, map: MapDefinition) {
  const ids = new Set([map.startNodeId]);
  const edges: { from: string; edge: MapEdgeDefinition }[] = [];
  const queue = [map.startNodeId];
  for (let i = 0; i < queue.length; i++) for (const edge of map.nodes[queue[i]]?.edges ?? []) {
    if (!map.nodes[edge.toNodeId] || (edge.hidden && !isRouteDiscovered(game, map.id, queue[i], edge.id))) continue;
    edges.push({ from: queue[i], edge });
    if (!ids.has(edge.toNodeId)) { ids.add(edge.toNodeId); queue.push(edge.toNodeId); }
  }
  const depth: Record<string, number> = { [map.startNodeId]: 0 };
  // 已校验目录是 DAG；有界松弛也能安全处理导入中的坏数据。
  for (let i = 0; i < ids.size; i++) for (const { from, edge } of edges) if (depth[from] !== undefined) depth[edge.toNodeId] = Math.max(depth[edge.toNodeId] ?? 0, depth[from] + 1);
  const max = Math.max(1, ...Object.values(depth));
  const positions: Record<string, { x: number; y: number }> = {};
  for (let d = 0; d <= max; d++) {
    const level = [...ids].filter(id => (depth[id] ?? 0) === d);
    level.forEach((id, i) => { positions[id] = { x: 100 * (i + 1) / (level.length + 1), y: 84 - d / max * 68 }; });
  }
  return { ids: [...ids], edges, positions };
}
