import { describe, expect, it } from 'vitest';
import { catalog } from '../domain/catalog';
import { createInitialState } from '../domain/engine';
import { changeQuantity, extractionPlan, knownMapGraph, latestUnlockedMapId, routeHint, subtract } from './adventureModel';

describe('action view models', () => {
  it('defaults to the last valid unlock, not map name or catalog order', () => {
    const maps = { earlier: {} as typeof catalog.maps[string], later: {} as typeof catalog.maps[string] };
    expect(latestUnlockedMapId(['earlier', 'later'], maps)).toBe('later');
    expect(latestUnlockedMapId(['later', 'earlier'], maps)).toBe('earlier');
    expect(latestUnlockedMapId(['earlier', 'removed'], maps)).toBe('earlier');
    expect(latestUnlockedMapId([], maps)).toBe('');
    expect(latestUnlockedMapId(['removed'], maps)).toBe('');
  });
  it('keeps extraction transfers reversible and preserves the entire quantity', () => {
    const cargo = { paper: 12, 'cloth-strip': 8 }; let keep = {};
    for (let i = 0; i < 40; i++) {
      keep = changeQuantity(keep, 'paper', 1);
      expect(extractionPlan(cargo, keep, {}).sell.paper).toBe(11);
      keep = changeQuantity(keep, 'paper', -1);
      expect(extractionPlan(cargo, keep, {}).sell).toEqual(cargo);
    }
    expect(subtract(cargo, { paper: 99 })).toEqual({ 'cloth-strip': 8 });
    expect(() => extractionPlan(cargo, { paper: 8 }, { paper: 5 })).toThrow();
  });
  it('does not reveal a never-traversed hidden branch even with a matching tag', () => {
    const state = createInitialState();
    const map = structuredClone(catalog.maps[state.unlockedMapIds[0]]);
    const start = map.nodes[map.startNodeId];
    start.edges = [{ id: 'secret', label: '秘密', description: '', toNodeId: 'secret', durationMs: 1, hidden: true, requirement: { tagId: 'lucky' } }];
    map.nodes.secret = { id: 'secret', name: '秘密地点', edges: [], terminal: true };
    Object.values(state.pets)[0].growthTagIds = ['lucky'];
    expect(knownMapGraph(state, map).ids).toEqual([map.startNodeId]);
    state.discoveredRouteKeys = [`${map.id}:${map.startNodeId}:secret`];
    expect(knownMapGraph(state, map).ids).toContain('secret');
  });
  it('ordinary route hints respect all three intel levels', () => {
    const state = createInitialState(), pets = Object.keys(state.pets);
    const edge = { id: 'test', label: '', description: '', toNodeId: '', durationMs: 1, requirement: { secondary: { stat: 'courage' as const, value: 9 } } };
    expect(routeHint(state, pets, edge, 1)).toBe('某项属性不足');
    expect(routeHint(state, pets, edge, 2)).toBe('勇气不足');
    expect(routeHint(state, pets, edge, 3)).toContain('勇气 ≥ 9');
  });
});
