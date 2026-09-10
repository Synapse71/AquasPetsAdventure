// 物品 Tag：给物品分类的标签，一件物品可以有多个，也可以一个都没有。
//
// 注意与「宠物 Tag」区分，两者同名但完全无关：
//   - 宠物 Tag（catalog.tags / TagDefinition / Pet.growthTagIds）
//     是宠物的永久特质，见系统设计文档第 7 节。
//   - 物品 Tag（本文件 / ItemDefinition.tags）只是物品的分类标签。
//   - ItemDefinition.tagGrantId 属于前者：它指向一个宠物 Tag。
//
// 下面是已知标签。物品可以使用列表之外的字符串，配置校验只给出提醒而不拦截，
// 这样加新分类不需要改代码；但拼错也会被提醒出来。

export const ITEM_TAGS = [
  "material",
  "tool",
  "food",
  "consumable",
  "secondary-growth",
  "trait-grant",
  "collectible",
] as const;

export type ItemTag = (typeof ITEM_TAGS)[number];

export const ITEM_TAG_LABELS: Record<ItemTag, string> = {
  material: "材料",
  tool: "工具",
  food: "食物",
  consumable: "消耗品",
  "secondary-growth": "次要属性成长",
  "trait-grant": "赋予特质",
  collectible: "收藏品",
};

export function isKnownItemTag(value: unknown): value is ItemTag {
  return (
    typeof value === "string" && (ITEM_TAGS as readonly string[]).includes(value)
  );
}

export function itemTagLabel(tag: string): string {
  return isKnownItemTag(tag) ? ITEM_TAG_LABELS[tag] : tag;
}
