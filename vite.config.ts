import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { catalogPublishPlugin } from "./configPublishPlugin";

export default defineConfig({
  base: "./",
  plugins: [react(), catalogPublishPlugin()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
