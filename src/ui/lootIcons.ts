// 战利品图标由物品 ID 匹配，忽略所在稀有度目录。这样策划调整档位后，
// Demo 图鉴和配置台仍会使用同一张图，不需要同步改 import。
const modules = import.meta.glob<string>("../../assets/loot/icons/*/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

const byItemId = new Map<string, string>();
for (const [path, url] of Object.entries(modules)) {
  const file = path.split("/").pop();
  if (!file) continue;
  byItemId.set(file.replace(/\.png$/, ""), url);
}

export function lootIconUrl(itemId: string): string | undefined {
  return byItemId.get(itemId);
}

export function lootIconIds(): string[] {
  return [...byItemId.keys()];
}
