import { build } from "vite";
import { expect, it, vi } from "vitest";

it("excludes the entire authoring module graph and styles from the production build", async () => {
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
    expect(modules.some(id => id.includes("configPublishPlugin"))).toBe(false);
    if (!("output" in result)) throw new Error("Expected a single application build");
    const text = result.output.map(output => output.type === "chunk" ? output.code : String(output.source)).join("\n");
    for (const marker of ["/__idle-config/", "config-publish-overlay", "idle-pet-adventure.catalog.published", "idle-pet-adventure.catalog.draft"]) {
      expect(text).not.toContain(marker);
    }
  } finally {
    vi.unstubAllEnvs();
  }
}, 30000);
