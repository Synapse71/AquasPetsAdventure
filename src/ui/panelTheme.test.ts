import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 深色模式已经整个去掉：面板一律白底，开箱视频等白底素材才能直接铺上去。
// 这条用读文件的方式守着，比起冒烟里切 prefers-color-scheme 截图，不用起 Electron。
function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

describe("面板不做深色适配", () => {
  it("src 下没有任何 CSS 再声明深色模式", () => {
    const offenders = cssFiles("src").filter(path =>
      readFileSync(path, "utf8").includes("prefers-color-scheme"),
    );
    expect(offenders).toEqual([]);
  });

  it("扫描确实覆盖到了面板样式，不是因为没找到文件才通过", () => {
    const files = cssFiles("src");
    expect(files).toContain(join("src", "ui", "adventurePanel.css"));
    expect(files.length).toBeGreaterThan(5);
  });
});
