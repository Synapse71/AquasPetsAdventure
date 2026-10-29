import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bundledCatalog, setCatalog } from './catalog';
import { mapEntryNodeIds } from './mapEntries';
import { chooseRoute, completeTask, confirmExtraction, createInitialState, mapIsCleared, requestExtraction, startExpedition, tick } from './engine';
import { estimateMapIncome } from './gacha';
import { knownMapGraph } from '../ui/adventureModel';
import { validateCatalog } from '../config/catalogStore';
import { nodeDepths, nodeRole, removeNodeFromMap } from '../config/mapNodeDraft';

import layoutPositions from './yuwan-layout.positions.json';
const historicalPositions: Record<string, { x: number; y: number }> = layoutPositions;

const map = bundledCatalog.maps['map-3'];
function allPaths(): string[][] {
  const paths: string[][] = [];
  const walk = (path: string[]) => {
    const node = map.nodes[path.at(-1)!];
    if (node.terminal) { paths.push(path); return; }
    expect(node.edges.length).toBeGreaterThan(0);
    for (const edge of node.edges) {
      expect(path).not.toContain(edge.toNodeId);
      walk([...path, edge.toNodeId]);
    }
  };
  mapEntryNodeIds(map).forEach(id => walk([id]));
  return paths;
}
function ready() {
  const state = createInitialState();
  // 本组只验证地图拓扑；已招募后不再触发新增的 Doro 固定事件。
  state.pets.doro = structuredClone(bundledCatalog.petTemplates.doro);
  state.unlockedMapIds.push(map.id);
  return state;
}
function arrivePath(path: string[]) {
  let state = ready();
  state = startExpedition(state, { mapId: map.id, startNodeId: path[0], petIds: [Object.keys(state.pets)[0]] }, 1_000);
  const seed = state.expeditions[0].currentSeed;
  state = tick(state, state.expeditions[0].arriveAt);
  expect(state.expeditions[0].completedNodeCount).toBe(0);
  for (let i = 1; i < path.length; i++) {
    const e = state.expeditions[0];
    const edge = map.nodes[path[i - 1]].edges.find(edge => edge.toNodeId === path[i])!;
    state = chooseRoute(state, e.id, edge.id, e.arriveAt);
    state = tick(state, state.expeditions[0].arriveAt);
    expect(state.expeditions[0].currentNodeId).toBe(path[i]);
    expect(state.expeditions[0].currentEventId).toBeUndefined();
    expect(state.expeditions[0].pendingLoot).toBeUndefined();
    expect(state.expeditions[0].cargo).toEqual({});
  }
  expect(state.expeditions[0].currentSeed).toBe(seed);
  return state;
}

describe('榆湾旧镇导入', () => {
  // 拓扑流程测试独立于正式掉落、事件和门槛；正式配表由 yuwanBalance.test 验证。
  beforeEach(() => {
    const topologyOnly = structuredClone(bundledCatalog);
    for (const node of Object.values(topologyOnly.maps['map-3'].nodes)) {
      delete node.loot;
      delete node.eventPoolIds;
      delete node.fixedEventIds;
      delete node.firstExtractionRewards;
      for (const edge of node.edges) delete edge.requirement;
    }
    setCatalog(topologyOnly);
  });
  afterEach(() => setCatalog(structuredClone(bundledCatalog)));

  it('与批准的矢量图节点、原始布局、连接一致', () => {
    const svg = readFileSync(new URL('../../docs/maps/yuwan-town-map.svg', import.meta.url), 'utf8');
    const document = readFileSync(new URL('../../docs/maps/yuwan-town-design.md', import.meta.url), 'utf8');
    const positions = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="194" height="62".*?<text[^>]*class="meta">(\w+) · ([^<]+)<\/text><text[^>]*class="name">([^<]+)<\/text>/g)];
    expect(positions).toHaveLength(19);
    for (const [, x, y, id, role, name] of positions) {
      const nodeId = `m3-${id.toLowerCase()}`, node = map.nodes[nodeId];
      expect(node.name).toBe(name);
      expect(historicalPositions[nodeId].x).toBeCloseTo((Number(x) + 97) / 1500 * 100, 5);
      expect(historicalPositions[nodeId].y).toBeCloseTo((Number(y) + 31) / 1460 * 100, 5);
      expect(!!node.terminal).toBe(role === '终点');
      expect(!!node.extractable).toBe(role === '撤离');
      expect(mapEntryNodeIds(map).includes(nodeId)).toBe(role === '起点');
      const row = document.split('\n').find(line => line.startsWith(`| ${id} `))!;
      const outgoing = [...row.split('|')[5].matchAll(/：([A-Z]\d) /g)].map(m => `m3-${m[1].toLowerCase()}`);
      expect(node.edges.map(e => e.toNodeId).sort()).toEqual(outgoing.sort());
    }
    expect(validateCatalog(bundledCatalog)).toEqual([]);
  });

  it('所有完整路线都在中点撤离，两个入口各自可到达两个终点', () => {
    const paths = allPaths();
    expect(paths).toHaveLength(32);
    for (const p of paths) {
      expect(p).toHaveLength(7);
      expect(p.filter(id => map.nodes[id].extractable)).toEqual([p[3]]);
    }
    for (const start of mapEntryNodeIds(map)) expect(new Set(paths.filter(p => p[0] === start).map(p => p.at(-1))).size).toBe(2);
    expect(new Set(paths.flat()).size).toBe(19);
    expect(estimateMapIncome(map).pathCount).toBe(32);
    const graph = knownMapGraph(ready(), map);
    expect(graph.ids).toHaveLength(19);
    expect(graph.edges).toHaveLength(26);
  });

  it('全部路线在没有战利品/事件时仍能走到终点并结算', () => {
    for (const path of allPaths()) {
      let state = arrivePath(path);
      expect(state.expeditions[0].phase).toBe('extraction');
      expect(state.expeditions[0].completedNodeCount).toBe(6);
      state = confirmExtraction(state, state.expeditions[0].id, state.expeditions[0].arriveAt);
      expect(state.expeditions).toHaveLength(0);
      expect(mapIsCleared(state, map.id)).toBe(true);
    }
  });

  it('三个中途撤离点可提前结算，普通节点与入口不能撤离', () => {
    for (const id of ['m3-e1', 'm3-e2', 'm3-e3']) {
      const path = allPaths().find(p => p[3] === id)!;
      let state = arrivePath(path.slice(0, 4));
      expect(state.expeditions[0].phase).toBe('awaiting-route');
      state = requestExtraction(state, state.expeditions[0].id);
      state = confirmExtraction(state, state.expeditions[0].id);
      expect(mapIsCleared(state, map.id)).toBe(false);
      expect(state.completedExtractionNodeKeys).toContain(`${map.id}:${id}`);
    }
    for (const n of [1, 2]) {
      const state = arrivePath(allPaths()[0].slice(0, n));
      expect(() => requestExtraction(state, state.expeditions[0].id)).toThrow('不是撤离点');
    }
  });

  it('拒绝以普通节点出发，并兼容旧地图的默认入口', () => {
    const state = ready(), petIds = [Object.keys(state.pets)[0]];
    expect(() => startExpedition(state, { mapId: map.id, petIds, startNodeId: 'm3-a1' })).toThrow('有效的地图入口');
    expect(startExpedition(state, { mapId: 'map-1', petIds }).expeditions[0].targetNodeId).toBe(bundledCatalog.maps['map-1'].startNodeId);
  });

  it('配置台按多个入口计算可达性，删除默认入口时保留另一入口', () => {
    const record = structuredClone(map) as unknown as Record<string, unknown>;
    const depths = nodeDepths(map.nodes, mapEntryNodeIds(map));
    expect(depths.size).toBe(19);
    expect(depths.get('m3-s2')).toBe(0);
    expect(nodeRole(map.nodes['m3-s2'], 'm3-s2', mapEntryNodeIds(map), true)).toBe('entry');
    const next = removeNodeFromMap(record, 'm3-s1')!;
    expect(next.startNodeId).toBe('m3-s2');
    expect(next.startNodeIds).toEqual(['m3-s2']);
    expect(next.nodePositions).not.toHaveProperty('m3-s1');
  });

  it('领取北山驿站任务后解锁第三图', () => {
    const state = createInitialState();
    state.completedTaskIds.push('tasks-pass-map-1');
    state.completedExtractionNodeKeys.push('map-2:m2-goal-1');
    const next = completeTask(state, 'tasks-pass-map-2');
    expect(next.unlockedMapIds).toContain('map-3');
  });

  it('配置校验拒绝坏入口列表及第二入口的撤离标记', () => {
    for (const entries of [['m3-s1', 'missing'], ['m3-s2'], ['m3-s1', 'm3-s1']]) {
      const data = structuredClone(bundledCatalog);
      data.maps['map-3'].startNodeIds = entries;
      expect(validateCatalog(data).some(i => i.path === 'maps.map-3.startNodeIds' && i.level === 'error')).toBe(true);
    }
    const data = structuredClone(bundledCatalog);
    data.maps['map-3'].nodes['m3-s2'].extractable = true;
    expect(validateCatalog(data).some(i => i.path === 'maps.map-3.nodes.m3-s2.extractable')).toBe(true);
  });
});
