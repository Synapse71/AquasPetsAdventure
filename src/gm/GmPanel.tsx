import { useEffect, useState } from "react";
import type { GameState } from "../domain/types";
import { addCurrency, arriveNow, fastForward, healResting, nextArrivalIn, restingInjuredCount } from "./gmActions";
import "./gmPanel.css";

/** App 在 dev 下挂到 window 上的把手。GM 后台不碰 React 树，只借这个口子读写存档。 */
export interface GmBridge {
  getGame(): GameState;
  run(action: (state: GameState) => GameState): boolean;
}

const bridge = () => (window as typeof window & { __idleGm?: GmBridge }).__idleGm;

function countdown(ms: number | null): string {
  if (ms === null) return "没有队伍在路上";
  const seconds = Math.ceil(ms / 1000);
  return `行进剩余 ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function GmPanel() {
  const [open, setOpen] = useState(true);
  const [game, setGame] = useState<GameState | null>(null);
  const [now, setNow] = useState(Date.now());

  // App 比 GM 后台先渲染完，但把手是在 effect 里挂的，所以一律轮询着取，不在挂载时抢一次。
  useEffect(() => {
    const read = () => { setNow(Date.now()); setGame(bridge()?.getGame() ?? null); };
    read();
    const timer = window.setInterval(read, 500);
    return () => window.clearInterval(timer);
  }, []);

  const apply = (action: (state: GameState) => GameState) => {
    const handle = bridge();
    if (!handle) return;
    handle.run(action);
    setGame(handle.getGame());
  };

  if (!open) {
    return <button className="gm-chip" data-desktop-ui type="button" onClick={() => setOpen(true)}>GM</button>;
  }

  const traveling = game ? nextArrivalIn(game, now) : null;
  const resting = game ? restingInjuredCount(game) : 0;
  return (
    <section className="gm-panel" data-desktop-ui aria-label="GM 后台">
      <header>
        <strong>GM 后台</strong>
        <span>仅开发模式</span>
        <button type="button" aria-label="收起 GM 后台" onClick={() => setOpen(false)}>—</button>
      </header>
      <p className="gm-status">{game ? countdown(traveling) : "等待存档加载…"}</p>
      <div className="gm-actions">
        <button type="button" disabled={traveling === null} onClick={() => apply(state => arriveNow(state, Date.now()))}>立即抵达</button>
        <button type="button" disabled={!game} onClick={() => apply(state => fastForward(state, 10 * 60_000, Date.now()))}>快进 10 分</button>
        <button type="button" disabled={!game} onClick={() => apply(state => fastForward(state, 60 * 60_000, Date.now()))}>快进 1 时</button>
        <button type="button" disabled={!resting} onClick={() => apply(state => healResting(state, Date.now()))}>基地伤势痊愈{resting ? ` (${resting})` : ""}</button>
        <button type="button" disabled={!game} onClick={() => apply(state => addCurrency(state, 1000))}>+1000 金币</button>
      </div>
      <p className="gm-note">金币 {game?.currency ?? "—"} · 出门在外的宠物不会被治疗（途中本来就不自愈）</p>
    </section>
  );
}
