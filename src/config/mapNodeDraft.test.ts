import { describe, expect, it } from "vitest";
import {
  addEdgeToMap,
  applyEdgeDraft,
  applyNodeDraft,
  countIncomingEdges,
  edgeAt,
  edgeRole,
  isDraftDirty,
  mapNodes,
  nodeRole,
  removeEdgeFromMap,
  removeNodeFromMap,
} from "./mapNodeDraft";

function sampleMap(): Record<string, unknown> {
  return {
    id: "map-forest",
    name: "针叶林",
    startNodeId: "entry",
    nodes: {
      entry: { id: "entry", name: "入口", edges: [{ toNodeId: "fork" }] },
      fork: {
        id: "fork",
        name: "岔路",
        edges: [{ toNodeId: "exit" }, { toNodeId: "exit", hidden: true }],
      },
      exit: { id: "exit", name: "撤离点", terminal: true, edges: [] },
    },
  };
}

describe("节点草稿比对", () => {
  it("键顺序不同但内容相同时不算改动", () => {
    expect(isDraftDirty({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(isDraftDirty({ edges: [{ toNodeId: "x" }] }, { edges: [{ toNodeId: "x" }] })).toBe(false);
  });

  it("值变化和数组顺序变化都算改动", () => {
    expect(isDraftDirty({ name: "旧" }, { name: "新" })).toBe(true);
    expect(isDraftDirty({ edges: ["a", "b"] }, { edges: ["b", "a"] })).toBe(true);
  });

  it("把字段清成 undefined 等同于没有该字段", () => {
    expect(isDraftDirty({ name: "入口", extractable: undefined }, { name: "入口" })).toBe(false);
  });
});

describe("保存节点草稿", () => {
  it("只替换目标节点，其余节点原样保留", () => {
    const record = sampleMap();
    const next = applyNodeDraft(record, "fork", { id: "fork", name: "改过的岔路", edges: [] });
    expect(mapNodes(next).fork).toEqual({ id: "fork", name: "改过的岔路", edges: [] });
    expect(mapNodes(next).entry).toEqual(mapNodes(record).entry);
  });

  it("不修改传入的地图记录", () => {
    const record = sampleMap();
    applyNodeDraft(record, "fork", { name: "改过的岔路" });
    expect((mapNodes(record).fork as Record<string, unknown>).name).toBe("岔路");
  });

  it("强制保留节点 id，草稿改 id 也不会写出对不上 key 的节点", () => {
    const next = applyNodeDraft(sampleMap(), "fork", { id: "另一个", name: "岔路" });
    expect((mapNodes(next).fork as Record<string, unknown>).id).toBe("fork");
    expect(mapNodes(next)["另一个"]).toBeUndefined();
  });
});

describe("删除节点", () => {
  it("统计指向该节点的路线条数", () => {
    expect(countIncomingEdges(mapNodes(sampleMap()), "exit")).toBe(2);
    expect(countIncomingEdges(mapNodes(sampleMap()), "entry")).toBe(0);
  });

  it("连带删掉指向它的路线", () => {
    const next = removeNodeFromMap(sampleMap(), "exit")!;
    expect(mapNodes(next).exit).toBeUndefined();
    expect((mapNodes(next).fork as Record<string, unknown>).edges).toEqual([]);
  });

  it("删掉起始节点时把起点改指剩余的第一个节点", () => {
    const next = removeNodeFromMap(sampleMap(), "entry")!;
    expect(next.startNodeId).toBe("fork");
  });

  it("拒绝删除最后一个节点，也拒绝删除不存在的节点", () => {
    const single = { nodes: { only: { id: "only" } } };
    expect(removeNodeFromMap(single, "only")).toBeNull();
    expect(removeNodeFromMap(sampleMap(), "缺席")).toBeNull();
  });
});

describe("节点角色判定", () => {
  const nodes = mapNodes(sampleMap());
  it("入口优先于其它角色", () => {
    expect(nodeRole({ terminal: true }, "entry", "entry", true)).toBe("entry");
  });
  it("不可达优先于终点与撤离点", () => {
    expect(nodeRole(nodes.exit, "exit", "entry", false)).toBe("unreachable");
  });
  it("终点优先于撤离点", () => {
    expect(nodeRole({ terminal: true, extractable: true }, "x", "entry", true)).toBe("terminal");
    expect(nodeRole({ extractable: true }, "x", "entry", true)).toBe("extractable");
    expect(nodeRole({}, "x", "entry", true)).toBe("normal");
  });
});

describe("按拓扑图连线定位路线", () => {
  it("用起点加下标取到对应的那一条，越界返回 null", () => {
    const nodes = mapNodes(sampleMap());
    expect(edgeAt(nodes, "fork", 1)).toEqual({ toNodeId: "exit", hidden: true });
    expect(edgeAt(nodes, "fork", 2)).toBeNull();
    expect(edgeAt(nodes, "missing", 0)).toBeNull();
  });

  it("同一起点的两条路线互不干扰，改第二条不动第一条", () => {
    const map = sampleMap();
    const next = applyEdgeDraft(map, "fork", 1, {
      toNodeId: "exit",
      label: "暗道",
      hidden: true,
    })!;
    const edges = (mapNodes(next).fork as Record<string, unknown>).edges as Record<
      string,
      unknown
    >[];
    expect(edges[0]).toEqual({ toNodeId: "exit" });
    expect(edges[1].label).toBe("暗道");
    // 原记录不能被改动，否则浮层取消后草稿会污染已保存内容。
    expect(edgeAt(mapNodes(map), "fork", 1)).toEqual({ toNodeId: "exit", hidden: true });
  });

  it("定位不到的路线不写入，交给调用方提示", () => {
    expect(applyEdgeDraft(sampleMap(), "fork", 9, { toNodeId: "exit" })).toBeNull();
    expect(removeEdgeFromMap(sampleMap(), "missing", 0)).toBeNull();
  });
});

describe("增删路线", () => {
  it("删除一条后后面的路线下标前移，节点本身保留", () => {
    const next = removeEdgeFromMap(sampleMap(), "fork", 0)!;
    const fork = mapNodes(next).fork as Record<string, unknown>;
    expect(fork.edges).toEqual([{ toNodeId: "exit", hidden: true }]);
    expect(Object.keys(mapNodes(next))).toHaveLength(3);
  });

  it("新增路线返回它的下标，路线 ID 在同一节点内不重复", () => {
    const first = addEdgeToMap(sampleMap(), "exit", "entry")!;
    expect(first.index).toBe(0);
    const second = addEdgeToMap(first.record, "exit", "fork")!;
    expect(second.index).toBe(1);
    const edges = (mapNodes(second.record).exit as Record<string, unknown>)
      .edges as Record<string, unknown>[];
    expect(edges.map((edge) => edge.id)).toEqual(["route-1", "route-2"]);
    expect(edges[1].toNodeId).toBe("fork");
  });

  it("不允许自环，也不允许指向不存在的节点", () => {
    expect(addEdgeToMap(sampleMap(), "entry", "entry")).toBeNull();
    expect(addEdgeToMap(sampleMap(), "entry", "nowhere")).toBeNull();
  });
});

describe("路线角色判定", () => {
  it("隐藏、属性门槛、断头路各自可辨", () => {
    const nodes = mapNodes(sampleMap());
    expect(edgeRole({ toNodeId: "exit" }, nodes)).toBe("normal");
    expect(edgeRole({ toNodeId: "exit", hidden: true }, nodes)).toBe("hidden");
    expect(
      edgeRole(
        { toNodeId: "exit", requirement: { secondary: { stat: "eloquence", value: 2 } } },
        nodes,
      ),
    ).toBe("gated");
    expect(edgeRole({ toNodeId: "nowhere" }, nodes)).toBe("dangling");
    expect(edgeRole(null, nodes)).toBe("dangling");
  });
});
