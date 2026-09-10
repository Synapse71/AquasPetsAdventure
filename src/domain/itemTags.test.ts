import { describe, expect, it } from "vitest";
import { validateCatalog } from "../config/catalogStore";
import { bundledCatalog } from "./catalog";
import { ITEM_TAGS, isKnownItemTag, itemTagLabel } from "./itemTags";

function itemsWithTag(tag: string) {
  return Object.values(bundledCatalog.items).filter((item) =>
    item.tags?.includes(tag),
  );
}

describe("物品标签", () => {
  it("已知标签列表稳定", () => {
    expect(ITEM_TAGS).toEqual([
      "material",
      "tool",
      "food",
      "consumable",
      "secondary-growth",
      "trait-grant",
      "collectible",
    ]);
    expect(isKnownItemTag("tool")).toBe(true);
    expect(isKnownItemTag("material")).toBe(true);
    expect(isKnownItemTag("工具")).toBe(false);
    expect(isKnownItemTag(undefined)).toBe(false);
    expect(itemTagLabel("food")).toBe("食物");
    expect(itemTagLabel("material")).toBe("材料");
    expect(itemTagLabel("secondary-growth")).toBe("次要属性成长");
    expect(itemTagLabel("trait-grant")).toBe("赋予特质");
    expect(itemTagLabel("collectible")).toBe("收藏品");
    // 未知标签原样回显，不会变成 undefined。
    expect(itemTagLabel("quest")).toBe("quest");
  });

  it("目录里的标签都是合法的非空字符串且不重复", () => {
    for (const item of Object.values(bundledCatalog.items)) {
      if (item.tags === undefined) continue;
      expect(Array.isArray(item.tags), `${item.id} tags 必须是数组`).toBe(true);
      for (const tag of item.tags) {
        expect(typeof tag, `${item.id} 标签必须是字符串`).toBe("string");
        expect(tag.trim().length, `${item.id} 标签不能为空`).toBeGreaterThan(0);
      }
      expect(new Set(item.tags).size, `${item.id} 标签重复`).toBe(
        item.tags.length,
      );
    }
  });

  it("工具与食物已经打上标签", () => {
    const tools = itemsWithTag("tool").map((item) => item.name);
    const foods = itemsWithTag("food").map((item) => item.name);

    expect(tools).toEqual(
      expect.arrayContaining(["螺丝刀", "扳手", "锤子", "剪刀"]),
    );
    expect(foods).toEqual(
      expect.arrayContaining(["巧克力", "罐头", "黑松露", "陈年威士忌"]),
    );
    // 标签是可选的：大部分物品没有标签。
    const untagged = Object.values(bundledCatalog.items).filter(
      (item) => !item.tags,
    );
    expect(untagged.length).toBeGreaterThan(0);
  });

  it("未知标签只提醒不拦截，格式错误才报错", () => {
    const probe = structuredClone(bundledCatalog);
    probe.items.paper.tags = ["quest"];
    const warnings = validateCatalog(probe);
    expect(warnings.filter((i) => i.level === "error")).toEqual([]);
    expect(
      warnings.some(
        (i) => i.level === "warning" && i.path === "items.paper.tags",
      ),
    ).toBe(true);

    const broken = structuredClone(bundledCatalog);
    (broken.items.paper as { tags: unknown }).tags = "tool";
    expect(
      validateCatalog(broken).some(
        (i) => i.level === "error" && i.path === "items.paper.tags",
      ),
    ).toBe(true);

    const duplicated = structuredClone(bundledCatalog);
    duplicated.items.paper.tags = ["tool", "tool"];
    expect(
      validateCatalog(duplicated).some(
        (i) => i.level === "error" && i.message.includes("重复"),
      ),
    ).toBe(true);
  });
});
