import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 0.1.1 发布时设置面板还写着 v0.1.0——版本号写死在界面里就一定会漏改。
// 现在由 vite.config.ts 的 define 在构建期注入，这两条守着它别再退回去。
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("界面上的版本号", () => {
  it("等于 package.json 里的版本，不是另写一份", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    expect(__APP_VERSION__).toBe(pkg.version);
  });

  it("源码里没有写死的 vX.Y.Z", () => {
    const offenders = sourceFiles("src")
      .filter(path => /v\d+\.\d+\.\d+/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("扫描确实覆盖到了设置面板，不是因为没找到文件才通过", () => {
    expect(sourceFiles("src")).toContain(join("src", "ui", "SettingsPanel.tsx"));
  });
});
