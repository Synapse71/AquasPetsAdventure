import { describe, expect, it } from "vitest";
import {
  applyNodeDraft,
  countIncomingEdges,
  isNodeDirty,
  mapNodes,
  nodeRole,
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
    expect(isNodeDirty({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(isNodeDirty({ edges: [{ toNodeId: "x" }] }, { edges: [{ toNodeId: "x" }] })).toBe(false);
  });

  it("值变化和数组顺序变化都算改动", () => {
    expect(isNodeDirty({ name: "旧" }, { name: "新" })).toBe(true);
    expect(isNodeDirty({ edges: ["a", "b"] }, { edges: ["b", "a"] })).toBe(true);
  });

  it("把字段清成 undefined 等同于没有该字段", () => {
    expect(isNodeDirty({ name: "入口", extractable: undefined }, { name: "入口" })).toBe(false);
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
