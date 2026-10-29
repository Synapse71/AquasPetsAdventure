import { describe, expect, it } from 'vitest';
import { bundledCatalog as catalog } from './catalog';
import { estimateMapIncome } from './gacha';
import { nodeLootCandidates } from './engine';
import { RARITIES } from './rarity';
import { validateCatalog } from '../config/catalogStore';
import { hasRouteRequirement } from '../ui/adventureModel';

const map = catalog.maps['map-3'];
const gear = (id: string) => id === 'fishing-rod' || id.startsWith('fishing-rod-') || id.startsWith('fishing-basket-');

describe('榆湾旧镇收益配表', () => {
  it('每条路径描述都明确写出目标节点名称', () => {
    for (const node of Object.values(map.nodes)) {
      for (const edge of node.edges) {
        expect(edge.description).toBe(`前往${map.nodes[edge.toNodeId].name}`);
      }
    }
  });
  it('后台校验通过，完整路线收益符合锚点', () => {
    expect(validateCatalog(catalog).filter(i => i.level === 'error')).toEqual([]);
    const income = estimateMapIncome(map, catalog);
    const hours = income.durationMs / 3600000;
    expect(income.pathCount).toBe(32);
    expect(income.value / hours).toBeCloseTo(1001.50576, 3);
    expect(income.xp / hours).toBeCloseTo(38.53455, 3);
    expect(income.durationMs / 60000).toBeCloseTo(356.1875);
    console.info('地图收益（不含事件与首撤）', [1, 2, 3].map(n => {
      const r = estimateMapIncome(catalog.maps[`map-${n}`], catalog);
      return { map: n, minutes: r.durationMs / 60000, goldPerHour: r.value / (r.durationMs / 3600000), xpPerHour: r.xp / (r.durationMs / 3600000) };
    }));
  });

  it('三张图所有有效稀有度都有候选物品，且绝不包含渔具', () => {
    for (const id of ['map-1', 'map-2', 'map-3']) {
      for (const node of Object.values(catalog.maps[id].nodes)) {
        if (!node.loot) continue;
        for (const rarity of RARITIES) {
          const candidates = nodeLootCandidates(node.loot, rarity, catalog);
          expect(candidates.some(item => gear(item.id))).toBe(false);
          const active = node.loot.mode === 'independent'
            ? (node.loot.rarityWeights[rarity] ?? 0) > 0
            : node.loot.compositions.some(c => c.weight > 0 && (c.rarityCounts[rarity] ?? 0) > 0);
          if (active) expect(candidates.length, `${id}/${node.id}/${rarity}`).toBeGreaterThan(0);
        }
      }
    }
    expect(JSON.stringify(catalog.events)).not.toMatch(/"fishing-(?:rod|basket)/);
  });

  it('门槛、时间、事件覆盖和 Doro 固定触发配置正确', () => {
    const edges = Object.values(map.nodes).flatMap(n => n.edges);
    expect(edges.filter(hasRouteRequirement)).toHaveLength(2);
    expect(edges.filter(e => e.durationMs === 3600000)).toHaveLength(22);
    for (const e of edges) {
      expect(e.durationMs).toBeGreaterThanOrEqual(45 * 60000);
      expect(e.durationMs).toBeLessThanOrEqual(75 * 60000);
    }
    expect(hasRouteRequirement(map.nodes['m3-e2'].edges.find(e => e.toNodeId === 'm3-c1')!)).toBe(false);
    expect(map.nodes['m3-c1'].edges.find(e => e.toNodeId === 'm3-d2')?.requirement).toEqual({ secondary: { stat: 'lore', value: 3 } });
    expect(map.nodes['m3-c3'].edges.find(e => e.toNodeId === 'm3-d3')?.requirement).toEqual({ secondary: { stat: 'guile', value: 3 } });
    expect(Object.values(map.nodes).filter(n => n.eventPoolIds?.length || n.fixedEventIds?.length)).toHaveLength(8);
    expect(map.nodes['m3-d2'].fixedEventIds).toEqual(['doro-encounter']);
    expect(catalog.events['doro-encounter'].absentPetIds).toEqual(['doro']);
    for (const node of Object.values(map.nodes)) {
      if (node.terminal || node.extractable) expect(node.eventPoolIds ?? []).toEqual([]);
    }
    expect(map.nodes['m3-t1'].firstExtractionRewards).toEqual({ 'cracked-core': 1 });
    expect(map.nodes['m3-t2'].firstExtractionRewards).toEqual({ 'icarus-mech-model': 1 });
  });
});
