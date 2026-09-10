import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./ui/styles.css";

async function bootstrap() {
  let RootApp = App;
  // Production uses the bundled catalog and excludes all editor code/overrides.
  if (import.meta.env.DEV) {
    const { initializeCatalog } = await import("./config/catalogStore");
    initializeCatalog();
    if (new URLSearchParams(window.location.search).has("config")) {
      const { ConfigApp } = await import("./config/ConfigApp");
      RootApp = ConfigApp;
    }
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode><RootApp /></StrictMode>,
  );
}

void bootstrap();
