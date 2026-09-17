import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./ui/styles.css";

async function bootstrap() {
  let RootApp = App;
  let editing = false;
  // Production uses the bundled catalog and excludes all editor code/overrides.
  if (import.meta.env.DEV) {
    const { initializeCatalog } = await import("./config/catalogStore");
    initializeCatalog();
    if (new URLSearchParams(window.location.search).has("config")) {
      const { ConfigApp } = await import("./config/ConfigApp");
      RootApp = ConfigApp;
      editing = true;
    }
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode><RootApp /></StrictMode>,
  );

  // GM 后台和配置台一样是 dev-only：import.meta.env.DEV 在生产构建里是字面 false，
  // 整个 if 连同里面的动态 import 会被摇掉，src/gm/ 一个字节都不进产物。
  // 配置台界面不需要它，所以只在正常游戏界面挂。
  if (import.meta.env.DEV && !editing) {
    const { mountGmPanel } = await import("./gm/mountGmPanel");
    mountGmPanel();
  }
}

void bootstrap();
