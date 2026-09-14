import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundledCatalog, setCatalog } from './catalog';
import { createInitialState, startExpedition } from './engine';
import { normalizeStartTravelDuration, START_TRAVEL_DURATION_MS } from './expeditionTiming';
import { loadCatalogDraft, publishCatalog, saveCatalogDraft } from '../config/catalogStore';

afterEach(() => { vi.unstubAllGlobals(); setCatalog(bundledCatalog); });
describe('fixed start travel duration', () => {
  it.each([8000, 10000, 30000, 600000])('ignores legacy map start duration %i at runtime', duration => {
    const data = structuredClone(bundledCatalog), state = createInitialState();
    const mapId = state.unlockedMapIds[0];
    data.maps[mapId].startDurationMs = duration;
    const next = startExpedition(state, {mapId, petIds:[Object.keys(state.pets)[0]]}, 123000, data);
    expect(next.expeditions[0].arriveAt).toBe(138000);
  });
  it('normalizes every map without mutating its source or route durations', () => {
    const data = structuredClone(bundledCatalog);
    Object.values(data.maps).forEach(m => { m.startDurationMs=8000; });
    const next=normalizeStartTravelDuration(data);
    for(const [id,map] of Object.entries(next.maps)) {
      expect(map.startDurationMs).toBe(START_TRAVEL_DURATION_MS);
      expect(map.nodes).toEqual(data.maps[id].nodes);
      expect(data.maps[id].startDurationMs).toBe(8000);
    }
  });
  it('normalizes existing local drafts, saves and published catalogs', () => {
    const data=structuredClone(bundledCatalog);
    Object.values(data.maps).forEach(m=>{m.startDurationMs=8000;});
    const store=new Map([['idle-pet-adventure.catalog.draft.v6',JSON.stringify(data)]]);
    vi.stubGlobal('localStorage',{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v)});
    expect(Object.values(loadCatalogDraft().catalog.maps).every(m=>m.startDurationMs===15000)).toBe(true);
    saveCatalogDraft(data);
    expect(Object.values(JSON.parse(store.get('idle-pet-adventure.catalog.draft.v6')!).maps).every(m=>(m as {startDurationMs:number}).startDurationMs===15000)).toBe(true);
    expect(publishCatalog(data).filter(i=>i.level==='error')).toEqual([]);
    expect(Object.values(JSON.parse(store.get('idle-pet-adventure.catalog.published.v6')!).maps).every(m=>(m as {startDurationMs:number}).startDurationMs===15000)).toBe(true);
  });
});
