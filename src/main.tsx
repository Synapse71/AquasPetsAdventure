import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigApp } from "./config/ConfigApp";
import { initializeCatalog } from "./config/catalogStore";
import { App } from "./ui/App";
import "./ui/styles.css";

initializeCatalog();
const showConfig = new URLSearchParams(window.location.search).has("config");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {showConfig ? <ConfigApp /> : <App />}
  </StrictMode>,
);
