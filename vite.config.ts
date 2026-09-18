import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { catalogPublishPlugin } from "./configPublishPlugin";
import { version } from "./package.json";

export default defineConfig({
  base: "./",
  // 版本号在构建期注入成字面量。界面里写死会漏改（0.1.1 就漏了一次），
  // 而 import package.json 会把 scripts、devDependencies 一并带进产物。
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), catalogPublishPlugin()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
