/** 默认入口保留旧目录兼容；多入口地图额外保存完整入口列表。 */
export function mapEntryNodeIds(map: { startNodeId?: unknown; startNodeIds?: unknown }): string[] {
  return [...new Set([
    ...(typeof map.startNodeId === 'string' ? [map.startNodeId] : []),
    ...(Array.isArray(map.startNodeIds) ? map.startNodeIds.filter((id): id is string => typeof id === 'string') : []),
  ])];
}
