import { build } from "vite";
import { expect, it, vi } from "vitest";

// 这里盯着两套 dev-only 代码：配置台（src/config/）和 GM 后台（src/gm/）。
// 两者都只在 import.meta.env.DEV 里动态 import，靠的是生产构建把 DEV 换成字面 false 后摇掉。
// 这不是看代码能确定的事——真的跑一次生产构建、翻模块图和产物文本才算数。
it("excludes every dev-only module graph and style from the production build", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const modules: string[] = [];
  try {
    const result = await build({
      logLevel: "silent",
      build: { write: false, copyPublicDir: false },
      plugins: [{
        name: "assert-production-module-boundary",
        generateBundle(_options, bundle) {
          for (const output of Object.values(bundle)) {
            if (output.type === "chunk") modules.push(...Object.keys(output.modules));
          }
        },
      }],
    });
    expect(modules.some(id => id.endsWith("/src/ui/App.tsx"))).toBe(true);
    expect(modules.some(id => id.includes("/src/domain/catalog.bundled.json"))).toBe(true);
    expect(modules.filter(id => id.includes("/src/config/"))).toEqual([]);
    expect(modules.filter(id => id.includes("/src/gm/"))).toEqual([]);
    expect(modules.some(id => id.includes("configPublishPlugin"))).toBe(false);
    if (!("output" in result)) throw new Error("Expected a single application build");
    const text = result.output.map(output => output.type === "chunk" ? output.code : String(output.source)).join("\n");
    for (const marker of ["/__idle-config/", "config-publish-overlay", "idle-pet-adventure.catalog.published", "idle-pet-adventure.catalog.draft",
      // GM 后台：模块图之外再查一遍产物文本，连 App 里那个 dev 把手也不该留下。
      "__idleGm", "idle-gm-root", "gm-panel", "GM 后台"]) {
      expect(text).not.toContain(marker);
    }
  } finally {
    vi.unstubAllEnvs();
  }
}, 30000);
