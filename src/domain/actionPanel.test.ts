import { describe, expect, it } from 'vitest';
import { bundledCatalog } from './catalog';
import { confirmExtractionPlan, createInitialState, eventCheckRisk, primaryOutcomeForRoll, resolveEvent, startExpedition } from './engine';
import type { ExtractionPlan } from './engine';

function fixture() {
  const catalog = structuredClone(bundledCatalog);
  catalog.items.test = { id: 'test', name: '测试物品', rarity: 'common', weight: 1, stackSize: 10, sellable: true, sellValue: 7 };
  catalog.items.bound = { id: 'bound', name: '绑定奖励', rarity: 'epic', weight: 1, sellable: false };
  const initial = createInitialState();
  const petId = Object.keys(initial.pets)[0];
  initial.pets[petId].baseStats = { fitness: 20, perception: 20, technique: 20 };
  initial.inventory = { test: 8 };
  const mapId = initial.unlockedMapIds[0];
  const goal = Object.values(catalog.maps[mapId].nodes).find(n => n.terminal)!;
  goal.firstExtractionRewards = { bound: 1 };
  const state = startExpedition(initial, { mapId, petIds: [petId] }, 0, catalog);
  const e = state.expeditions[0];
  e.phase = 'extraction'; e.currentNodeId = goal.id; e.targetNodeId = goal.id; e.cargo = { test: 5 }; e.completedNodeCount = 1;
  return { catalog, state, e, petId };
}
describe('action panel engine transactions', () => {
  it('extracts kept/sold/discarded partitions atomically and keeps old stock immutable', () => {
    const { catalog, state, e } = fixture(), before = structuredClone(state);
    const next = confirmExtractionPlan(state, e.id, { keep: { test: 2 }, sell: { test: 2 }, discard: { test: 1 } }, 10, catalog);
    expect(state).toEqual(before);
    expect(next.inventory).toEqual({ test: 10, bound: 1 });
    expect(next.currency).toBe(state.currency + 14);
    expect(next.expeditions).toHaveLength(0);
    expect(next.settlements[0]).toMatchObject({ expeditionId: e.id, cargo: { test: 2 }, soldCargo: { test: 2 }, saleRevenue: 14, firstExtractionRewards: { bound: 1 } });
    expect(next.itemAcquisitionCounts.bound).toBe(1);
    expect(() => confirmExtractionPlan(next, e.id, { keep: {}, sell: {}, discard: {} }, 10, catalog)).toThrow();
  });
  it('does not partially sell when final warehouse validation fails', () => {
    const { catalog, state, e } = fixture(); state.warehouseSlots = 1;
    const before = structuredClone(state);
    expect(() => confirmExtractionPlan(state, e.id, { keep: {}, sell: { test: 5 }, discard: {} }, 10, catalog)).toThrow('仓库');
    expect(state).toEqual(before);
  });
  it('requires a complete exact partition with valid positive quantities', () => {
    const { catalog, state, e } = fixture();
    for (const plan of [
      { keep: { test: 4 }, sell: {}, discard: {} },
      { keep: { test: 5 }, sell: { test: 1 }, discard: {} },
      { keep: { test: 4.5 }, sell: { test: .5 }, discard: {} },
      { keep: { test: 5 }, sell: { unknown: 1 }, discard: {} },
      { keep: { test: 5 }, sell: { test: 0 }, discard: {} },
    ] as ExtractionPlan[]) expect(() => confirmExtractionPlan(state, e.id, plan, 10, catalog)).toThrow();
  });
  it('cannot implicitly sell unsellable goods; explicit discard is supported', () => {
    const { catalog, state, e } = fixture(); e.cargo = { bound: 2 };
    expect(() => confirmExtractionPlan(state, e.id, { keep: {}, sell: { bound: 2 }, discard: {} }, 10, catalog)).toThrow('不可出售');
    const next = confirmExtractionPlan(state, e.id, { keep: {}, sell: {}, discard: { bound: 2 } }, 10, catalog);
    expect(next.inventory.bound).toBe(1); // Only the first-extraction reward.
  });
  it('initial carried items do not generate new loot XP or acquisition counts', () => {
    const { catalog, state, e } = fixture(); catalog.maps[e.mapId].nodes[e.currentNodeId!].firstExtractionRewards = {};
    e.initialCargo = { test: 5 }; const before = structuredClone(state.itemAcquisitionCounts);
    const next = confirmExtractionPlan(state, e.id, { keep: { test: 2 }, sell: { test: 3 }, discard: {} }, 10, catalog);
    expect(next.settlements[0].xpAward).toBe(10 * (catalog.maps[e.mapId].xpMultiplier ?? 1));
    expect(next.itemAcquisitionCounts).toEqual(before);
  });
  it('stores both real lucky dice and the pre-injury risk, including defeat reports', () => {
    const { catalog, state, e, petId } = fixture();
    catalog.tags.lucky = { id: 'lucky', name: '幸运儿', description: '', eventRollAdvantage: true };
    state.pets[petId].growthTagIds = ['lucky']; state.pets[petId].injury = 'injured';
    catalog.events.check = { id: 'check', title: '测试事件', description: '', choices: [{ id: 'go', label: '尝试', description: '', resolution: { type: 'primary', stat: 'fitness', difficulty: 100 }, rewards: {} }] };
    e.phase = 'awaiting-event'; e.currentEventId = 'check';
    const risk = eventCheckRisk(state, e.id, 'go', catalog);
    const next = resolveEvent(state, e.id, 'go', 10, catalog);
    const result = next.settlements[0].lastResolution!;
    expect(result.outcome).toBe('big-failure');
    expect(result.check?.type).toBe('primary');
    if (result.check?.type === 'primary') { expect(result.check.rolls).toHaveLength(2); expect(result.check.rolls.every(n => n >= 1 && n <= 6)).toBe(true); expect(result.check.risk).toBe(risk); }
    expect(next.expeditions).toHaveLength(0);
    expect(() => resolveEvent(next, e.id, 'go', 10, catalog)).toThrow();
  });
  it('secondary decisions persist a value, never a fabricated die', () => {
    const { catalog, state, e } = fixture();
    catalog.events.check = { id: 'check', title: '测试', description: '', choices: [{ id: 'go', label: '尝试', description: '', resolution: { type: 'secondary', stat: 'lore', successThreshold: 1, extraSuccessThreshold: 100 }, rewards: {} }] };
    e.phase = 'awaiting-event'; e.currentEventId = 'check';
    const next = resolveEvent(state, e.id, 'go', 10, catalog);
    expect(next.expeditions[0].lastResolution?.check).toEqual({ type: 'secondary', value: state.pets[e.petIds[0]].secondaryStats.lore });
    expect(next.expeditions[0].lastResolution?.outcome).toBe('success');
  });
  it('uses one source for all D6 outcome thresholds', () => {
    expect([1, 2, 3, 4, 5, 6].map(n => primaryOutcomeForRoll(n, 0))).toEqual(['failure', 'failure', 'success', 'success', 'success', 'extra-success']);
    expect(primaryOutcomeForRoll(1, 2)).toBe('big-failure');
  });
});
