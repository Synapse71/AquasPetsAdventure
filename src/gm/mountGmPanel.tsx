import { createRoot } from "react-dom/client";
import { GmPanel } from "./GmPanel";

/**
 * GM 后台挂在 #root 之外的独立 React 根上：它不参与游戏的 state，
 * 只通过 window.__idleGm 这个 dev 把手读写存档，所以不需要塞进 App 的组件树。
 * 整个 src/gm/ 由 main.tsx 里的 import.meta.env.DEV 动态 import 引入，打包时会被摇掉；
 * src/config/productionBundle.test.ts 会真的跑一次生产构建来确认这件事。
 */
export function mountGmPanel(): void {
  if (document.getElementById("idle-gm-root")) return;
  const host = document.createElement("div");
  host.id = "idle-gm-root";
  document.body.appendChild(host);
  createRoot(host).render(<GmPanel />);
}
