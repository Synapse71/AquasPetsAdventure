import { describe, expect, it } from 'vitest';
import { bundledCatalog } from './catalog';
import { cargoSlotCapacity, chooseRoute, confirmExtraction, createInitialState, finishNodeLoot, pickupAllNodeLoot, pickupNodeLoot, requestExtraction, resolveEvent, startExpedition, tick } from './engine';

function arrived() {
  const catalog = structuredClone(bundledCatalog);
  catalog.items.paper.stackSize = 2;
  catalog.items.paper.weight = 100;
  catalog.maps['map-1'].nodes['m1-point-1'].eventPoolIds = [];
  let state = startExpedition(createInitialState(), {mapId:'map-1',petIds:['gugugaga']}, 1, catalog);
  state.expeditions[0].targetNodeId = 'm1-point-1';
  state = tick(state, state.expeditions[0].arriveAt, catalog);
  state.expeditions[0].arrivalLoot = {paper:5};
  state.expeditions[0].pendingLoot = {paper:5};
  return {state,catalog,id:state.expeditions[0].id};
}
describe('manual node loot', () => {
  it('arrival draws once without cargo or codex acquisition', () => {
    const {state,catalog} = arrived(), e = state.expeditions[0];
    expect(e.cargo).toEqual({});
    expect(state.itemAcquisitionCounts.paper).toBeUndefined();
    const late = tick(state, 1e12, catalog);
    expect(late.expeditions[0]).toEqual(e);
  });
  it('pickup moves exact quantities, keeps the drop snapshot, and records acquisition once', () => {
    const {state,catalog,id} = arrived();
    const next = pickupNodeLoot(state,id,'paper',1,100,catalog);
    expect(next.expeditions[0].cargo).toEqual({paper:1});
    expect(next.expeditions[0].pendingLoot).toEqual({paper:4});
    expect(next.expeditions[0].arrivalLoot).toEqual({paper:5});
    expect(next.itemAcquisitionCounts.paper).toBe(1);
    expect(state.expeditions[0].cargo).toEqual({});
    expect(pickupNodeLoot(next,id,'paper',2,101,catalog).itemAcquisitionCounts.paper).toBe(3);
  });
  it('slot limits are hard but weight is soft, including whole-stack pickup', () => {
    const {state,catalog,id} = arrived();
    const cap = cargoSlotCapacity(state,state.expeditions[0],catalog);
    state.expeditions[0].cargo = {paper:cap*2-1};
    expect(() => pickupNodeLoot(state,id,'paper',2,100,catalog)).toThrow('格子');
    const next = pickupAllNodeLoot(state,id,100,catalog);
    expect(next.expeditions[0].cargo.paper).toBe(cap*2);
    expect(next.expeditions[0].pendingLoot).toEqual({paper:4});
    expect(pickupAllNodeLoot(next,id,101,catalog)).toEqual(next);
  });
  it('zero, negative, fractional, excessive and unknown pickup cannot mutate state', () => {
    const {state,catalog,id} = arrived(), before = structuredClone(state);
    for (const q of [0,-1,.5,6,NaN]) expect(() => pickupNodeLoot(state,id,'paper',q,100,catalog)).toThrow();
    expect(() => pickupNodeLoot(state,id,'missing',1,100,catalog)).toThrow();
    expect(state).toEqual(before);
  });
  it('routes, events and extraction cannot bypass unfinished pickup', () => {
    const {state,catalog,id} = arrived();
    expect(() => chooseRoute(state,id,'route-2',100,catalog)).toThrow('拾取');
    state.expeditions[0].phase = 'awaiting-event';
    expect(() => resolveEvent(state,id,'any',100,catalog)).toThrow('拾取');
    state.expeditions[0].phase = 'extraction';
    expect(() => requestExtraction(state,id,100,catalog)).toThrow('拾取');
    expect(() => confirmExtraction(state,id,100,catalog)).toThrow('拾取');
  });
  it('remaining loot requires explicit abandonment and is never counted as an acquisition', () => {
    const {state,id} = arrived();
    expect(() => finishNodeLoot(state,id)).toThrow('确认丢弃');
    const next = finishNodeLoot(state,id,true,100);
    expect(next.expeditions[0].pendingLoot).toBeUndefined();
    expect(next.expeditions[0].cargo).toEqual({});
    expect(next.itemAcquisitionCounts.paper).toBeUndefined();
    expect(() => finishNodeLoot(next,id,true)).toThrow();
  });
  it('an empty pending bag still needs continue; afterwards next route works', () => {
    const {state,catalog,id} = arrived();
    const picked = pickupAllNodeLoot(state,id,100,catalog);
    expect(picked.expeditions[0].pendingLoot).toEqual({});
    expect(() => chooseRoute(picked,id,'route-2',100,catalog)).toThrow('拾取');
    const finished = finishNodeLoot(picked,id,false,100);
    expect(chooseRoute(finished,id,'route-2',101,catalog).expeditions[0].phase).toBe('traveling');
  });
  it('JSON save round-trip preserves pending loot but legacy reports never become pickups', () => {
    const {state,catalog,id} = arrived();
    const partial = pickupNodeLoot(state,id,'paper',1,100,catalog);
    const restored = JSON.parse(JSON.stringify(partial));
    expect(restored.expeditions[0].pendingLoot).toEqual({paper:4});
    const legacy = structuredClone(state);delete legacy.expeditions[0].pendingLoot;
    legacy.expeditions[0].cargo = {paper:5};
    expect(() => pickupNodeLoot(legacy,id,'paper',1,100,catalog)).toThrow('没有可拾取');
    expect(chooseRoute(legacy,id,'route-2',100,catalog).expeditions[0].cargo).toEqual({paper:5});
  });
});
