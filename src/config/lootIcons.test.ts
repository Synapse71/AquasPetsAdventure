import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { bundledCatalog } from "../domain/catalog";

// import.meta.glob 在 vitest 的 node 环境里不解析真实资源，
// 所以这里直接读磁盘，校验的是"图标文件名和物品 ID 对不对得上"这条约定。
const ICON_ROOT = "assets/loot/icons";

function iconIdsOnDisk(): Map<string, string> {
  const found = new Map<string, string>();
  for (const dir of readdirSync(ICON_ROOT)) {
    const path = join(ICON_ROOT, dir);
    if (!statSync(path).isDirectory()) continue;
    for (const file of readdirSync(path)) {
      if (file.endsWith(".png")) found.set(file.slice(0, -4), dir);
    }
  }
  return found;
}

describe("战利品图标", () => {
  it("每件物品都有同名图标，且没有多余图标", () => {
    const icons = iconIdsOnDisk();
    const itemIds = Object.keys(bundledCatalog.items);

    const missing = itemIds.filter((id) => !icons.has(id));
    const orphan = [...icons.keys()].filter(
      (id) => !(id in bundledCatalog.items),
    );

    expect(missing, `缺图标: ${missing.join(", ")}`).toEqual([]);
    expect(orphan, `多余图标: ${orphan.join(", ")}`).toEqual([]);
  });

  it("图标所在目录与物品档位一致", () => {
    const icons = iconIdsOnDisk();
    const wrong = Object.values(bundledCatalog.items)
      .filter((item) => icons.has(item.id) && icons.get(item.id) !== item.rarity)
      .map((item) => `${item.id} 在 ${icons.get(item.id)}/ 但档位是 ${item.rarity}`);

    // 只是整理约定；配置台按文件名匹配，放错目录也仍能显示。
    expect(wrong, wrong.join(" | ")).toEqual([]);
  });
});
