import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { catalogPublishPlugin } from "../../configPublishPlugin";

describe("local development server", () => {
  it("binds the documented IPv4 address", () => {
    expect(packageJson.scripts.dev).toContain("--host 127.0.0.1");
  });

  it("registers the local catalog publisher only for the dev server", () => {
    const plugin = catalogPublishPlugin(process.cwd());
    expect(plugin.name).toBe("idle-catalog-publisher");
    expect(plugin.apply).toBe("serve");
    expect(plugin.configureServer).toBeTypeOf("function");
  });
});
