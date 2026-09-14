// 节点编辑改成「点拓扑图 → 浮层表单 → 保存」之后，浮层里改的是节点草稿，
// 只有点保存才写回地图记录。这里放不依赖 React 的纯逻辑，方便单测覆盖。
type Record_ = Record<string, unknown>;

function isRecord(value: unknown): value is Record_ {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mapNodes(record: Record_): Record_ {
  return isRecord(record.nodes) ? record.nodes : {};
}

/** 草稿与已保存节点是否有差异；顺序不同但内容相同的对象视为无改动。 */
export function isNodeDirty(draft: unknown, saved: unknown): boolean {
  return stableStringify(draft) !== stableStringify(saved);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 把节点草稿写回地图记录，返回新记录；不修改传入对象。 */
export function applyNodeDraft(
  record: Record_,
  nodeId: string,
  draft: Record_,
): Record_ {
  const next = structuredClone(record);
  const nodes = isRecord(next.nodes) ? next.nodes : {};
  // id 由创建时决定，草稿改不了，避免浮层里改出一个对不上 key 的节点。
  nodes[nodeId] = { ...structuredClone(draft), id: nodeId };
  next.nodes = nodes;
  return next;
}

/** 有多少条路线指向该节点——删除前要告诉策划会连带删掉几条。 */
export function countIncomingEdges(nodes: Record_, nodeId: string): number {
  return Object.values(nodes).reduce<number>((total, value) => {
    if (!isRecord(value) || !Array.isArray(value.edges)) return total;
    return (
      total +
      value.edges.filter((edge) => isRecord(edge) && edge.toNodeId === nodeId)
        .length
    );
  }, 0);
}

/**
 * 删除节点，同时清掉指向它的路线；若删的是起始节点则改指剩余的第一个。
 * 最后一个节点不允许删除，此时返回 null 由调用方提示。
 */
export function removeNodeFromMap(
  record: Record_,
  nodeId: string,
): Record_ | null {
  const nodes = mapNodes(record);
  if (!Object.hasOwn(nodes, nodeId) || Object.keys(nodes).length <= 1) {
    return null;
  }
  const next = structuredClone(record);
  const nextNodes = isRecord(next.nodes) ? next.nodes : {};
  delete nextNodes[nodeId];
  for (const value of Object.values(nextNodes)) {
    if (!isRecord(value) || !Array.isArray(value.edges)) continue;
    value.edges = value.edges.filter(
      (edge) => !isRecord(edge) || edge.toNodeId !== nodeId,
    );
  }
  next.nodes = nextNodes;
  if (next.startNodeId === nodeId) next.startNodeId = Object.keys(nextNodes)[0];
  return next;
}

/**
 * 从入口出发的最短层级。拓扑图用它排布局，浮层用它判断「入口不可达」，
 * 两处共用同一份判定才不会出现图上标红、表单里却说是普通节点。
 * 非法环路的节点只会入队一次，不会把配置台卡死。
 */
export function nodeDepths(
  nodes: Record_,
  startNodeId: string,
): Map<string, number> {
  const depths = new Map<string, number>();
  if (!Object.hasOwn(nodes, startNodeId)) return depths;
  depths.set(startNodeId, 0);
  const queue = [startNodeId];
  while (queue.length) {
    const current = queue.shift()!;
    const value = nodes[current];
    if (!isRecord(value) || !Array.isArray(value.edges)) continue;
    const nextDepth = (depths.get(current) ?? 0) + 1;
    for (const edge of value.edges) {
      if (!isRecord(edge) || typeof edge.toNodeId !== "string") continue;
      if (!Object.hasOwn(nodes, edge.toNodeId)) continue;
      if (depths.has(edge.toNodeId)) continue;
      depths.set(edge.toNodeId, nextDepth);
      queue.push(edge.toNodeId);
    }
  }
  return depths;
}

/** 节点在拓扑图上的角色，浮层标题和图上配色共用同一套判定。 */
export function nodeRole(
  node: unknown,
  nodeId: string,
  startNodeId: string,
  reachable: boolean,
): "entry" | "unreachable" | "terminal" | "extractable" | "normal" {
  if (nodeId === startNodeId) return "entry";
  if (!reachable) return "unreachable";
  if (isRecord(node) && node.terminal === true) return "terminal";
  if (isRecord(node) && node.extractable === true) return "extractable";
  return "normal";
}

export const NODE_ROLE_LABELS: Record<string, string> = {
  entry: "地图入口",
  unreachable: "入口不可达",
  terminal: "固定终点",
  extractable: "中途撤离点",
  normal: "探索节点",
};
