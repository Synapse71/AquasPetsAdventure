import type { Catalog } from './types';

/** 前往起点是全局固定时长，不属于地图可调数值。 */
export const START_TRAVEL_DURATION_MS = 15_000;

/** 保留旧 JSON 字段以兼容导入，但所有写出统一为固定值。 */
export function normalizeStartTravelDuration(catalog: Catalog): Catalog {
  const next = structuredClone(catalog);
  for (const map of Object.values(next.maps ?? {})) {
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      map.startDurationMs = START_TRAVEL_DURATION_MS;
    }
  }
  return next;
}
