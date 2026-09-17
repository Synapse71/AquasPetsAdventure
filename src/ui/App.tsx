import { START_TRAVEL_DURATION_MS } from '../domain/expeditionTiming';
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { catalog } from "../domain/catalog";
import { RARITY_LABELS } from "../domain/rarity";
import { createInitialState, dismissSettlement, itemStackSize, recordMilestone, taskCanComplete, taskIsAvailable, tick, GameRuleError } from "../domain/engine";
import type { PlayerMilestoneId } from "../domain/milestones";
import type { GameState, Inventory, Settlement } from "../domain/types";
import { clearGame, loadGame, saveGame } from "../persistence/storage";
import { PetDesktop, PET_MENUS, type PanelId } from "./PetDesktop";
import { clearUIState } from "./uiState";
import { CodexPanel } from "./CodexPanel";
import { SettingsPanel } from "./SettingsPanel";
import { PetStatusPanel } from "./PetStatusPanel";
import { InventoryPanel } from "./InventoryPanel";
import { AdventurePanel } from "./AdventurePanel";

type Action = (state: GameState) => GameState;

const PANEL_MILESTONE_IDS: Record<PanelId, PlayerMilestoneId> = {
  adventure: "opened-adventure",
  inventory: "opened-inventory",
  pets: "opened-pets",
  codex: "opened-codex",
  settings: "opened-settings",
};

function formatTime(ms: number): string {
  if (ms <= 0) return "已抵达";
  const seconds = Math.ceil(ms / 1_000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}:${rest.toString().padStart(2, "0")}` : `${rest} 秒`;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

function InventoryRows({
  inventory,
  actions,
}: {
  inventory: Inventory;
  actions?: (itemId: string, quantity: number) => ReactNode;
}) {
  const rows = Object.entries(inventory).filter(([, quantity]) => quantity > 0);
  if (!rows.length) return <Empty>暂无物品</Empty>;
  return (
    <div className="inventory-list">
      {rows.map(([itemId, quantity]) => {
        const item = catalog.items[itemId];
        const stack = itemStackSize(itemId);
        const slots = Math.ceil(quantity / stack);
        return (
          <div className="inventory-row" key={itemId}>
            <div>
              <strong className={item ? `rarity-${item.rarity}` : undefined}>
                {item?.name ?? itemId}
              </strong>
              <span>
                {item ? `${RARITY_LABELS[item.rarity]} · ` : ""}× {quantity} ·{" "}
                {slots} 格{stack > 1 ? `（每格 ${stack}）` : ""} · 单重{" "}
                {item?.weight ?? 0}
                {item?.sellable ? ` · 售价 ${item.sellValue ?? 0}` : " · 不可出售"}
              </span>
            </div>
            {actions?.(itemId, quantity)}
          </div>
        );
      })}
    </div>
  );
}

// 冒险结束后的只读战报：经验和入库都已经在撤离那一刻完成了。
function SettlementCard({
  game,
  settlement,
  run,
}: {
  game: GameState;
  settlement: Settlement;
  run: (action: Action) => void;
}) {
  return (
    <article className="settlement-card">
      <div>
        <p className="eyebrow">
          {settlement.outcome === "success" ? "成功撤离" : "溃败结算"}
        </p>
        <h3>
          {settlement.petIds
            .map((id) => game.pets[id]?.name ?? id)
            .join("、")}
        </h3>
        <p>{settlement.summary}</p>
        <p className="muted">
          每只宠物已获得 {settlement.xpAward} XP。
          {settlement.outcome === "success"
            ? "战利品已直接入库。"
            : "本轮战利品全部遗失。"}
        </p>
      </div>
      {!!Object.keys(settlement.cargo).length && (
        <InventoryRows inventory={settlement.cargo} />
      )}
      {settlement.firstExtractionRewards &&
        !!Object.keys(settlement.firstExtractionRewards).length && (
          <div className="first-clear-preview">
            <strong>撤离点首次奖励</strong>
            <InventoryRows inventory={settlement.firstExtractionRewards} />
          </div>
        )}
      <button
        className="primary full"
        onClick={() => run((state) => dismissSettlement(state, settlement.id))}
      >
        知道了
      </button>
    </article>
  );
}

function ActivityPanel({ game }: { game: GameState }) {
  return (
    <>
      {!game.log.length && <p className="sp-empty">尚无行动记录。</p>}
      <ol className="log-list">
        {game.log.slice(0, 12).map((entry) => (
          <li key={entry.id}>
            <time>{new Date(entry.createdAt).toLocaleTimeString()}</time>
            <span>{entry.message}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function FloatingWindow({ panel, children }: { panel: PanelId; children: ReactNode }) {
  const side = panel === "adventure" ? "left" : "right";
  return <div className={`window-layer window-layer-${side}`} role="presentation">
    <section className={`game-window window-${panel} window-side-${side}`} role="dialog" aria-modal="false" aria-labelledby={`window-title-${panel}`}>{children}</section>
  </div>;
}

export function App() {
  const [game, setGame] = useState<GameState>(loadGame);
  const gameRef = useRef(game);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState<string>();
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);

  useEffect(() => {
    gameRef.current = game;
    saveGame(game);
  }, [game]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      const previous = gameRef.current;
      const hasArrival = previous.expeditions.some(
        (entry) => entry.phase === "traveling" && entry.arriveAt <= current,
      );
      // 伤势恢复也靠 tick 推进，队伍全都在家时同样需要跑。
      const hasRecovery = Object.values(previous.pets).some(
        (pet) =>
          pet.injuryRecoveredAt !== undefined &&
          pet.injuryRecoveredAt <= current,
      );
      if (hasArrival || hasRecovery) {
        const next = tick(previous, current);
        gameRef.current = next;
        setGame(next);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const run = useCallback((action: Action) => {
    try {
      const next = action(gameRef.current);
      gameRef.current = next;
      saveGame(next);
      setGame(next);
      setNotice(undefined);
      return true;
    } catch (error) {
      setNotice(
        error instanceof GameRuleError
          ? error.message
          : "操作失败，请查看控制台。",
      );
      if (!(error instanceof GameRuleError)) console.error(error);
      return false;
    }
  }, []);

  // GM 后台（src/gm/，只在 dev 存在）靠这个把手读写存档，免得把 GM 代码塞进 App 的组件树。
  // 生产构建里 import.meta.env.DEV 是字面 false，整个函数体会被摇掉。
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const target = window as typeof window & { __idleGm?: unknown };
    target.__idleGm = { getGame: () => gameRef.current, run };
    return () => { delete target.__idleGm; };
  }, [run]);

  const attentionExpedition = game.expeditions.find(entry => entry.phase !== "traveling");
  const pendingTask = Object.values(catalog.tasks).some(task => taskIsAvailable(game, task.id) && taskCanComplete(game, task.id));
  const pendingPoints = Object.values(game.pets).some(pet => pet.unspentPoints > 0);
  const stagePet = Object.values(game.pets)[0];
  const stageExpedition = game.expeditions.find(entry => entry.petIds.includes(stagePet?.id));
  const traveling = stageExpedition?.phase === "traveling" ? stageExpedition : undefined;
  const travelingMap = traveling && catalog.maps[traveling.mapId];
  const travelingEdge = traveling && travelingMap?.nodes[traveling.travelingFromNodeId ?? '']?.edges.find(edge => edge.id === traveling.travelingEdgeId);
  const segmentDuration = traveling && travelingMap
    ? travelingEdge?.durationMs ?? START_TRAVEL_DURATION_MS
    : 0;
  const [visitedPanels, setVisitedPanels] = useState<PanelId[]>([]);
  const [adventureIntent, setAdventureIntent] = useState<{ tab: "active" | "tasks"; key: number; expeditionId?: string }>();
  const [statusIntent, setStatusIntent] = useState<{ petId: string; key: number }>();
  const [saveGeneration, setSaveGeneration] = useState(0);

  const openPanel = (panel: PanelId) => {
    run(state => recordMilestone(state, PANEL_MILESTONE_IDS[panel]));
    setVisitedPanels(previous => previous.includes(panel) ? previous : [...previous, panel]);
    setActivePanel(panel);
  };
  const closePanel = useCallback(() => setActivePanel(null), []);
  const openPending = () => {
    if (attentionExpedition || pendingTask) {
      setAdventureIntent({ tab: attentionExpedition ? "active" : "tasks", key: Date.now(), expeditionId: attentionExpedition?.id });
      openPanel("adventure");
    } else if (pendingPoints) {
      const pet = Object.values(game.pets).find(pet => pet.unspentPoints > 0)!;
      setStatusIntent({ petId: pet.id, key: Date.now() });
      openPanel("pets");
    }
  };
  const resetDemo = () => {
    { // Confirmation belongs to SettingsPanel, not a native blocking dialog.
      clearGame(); clearUIState();
      const next = createInitialState();
      gameRef.current = next;
      saveGame(next);
      setGame(next);
      setActivePanel(null);
      setVisitedPanels([]);
      setAdventureIntent(undefined);
      setStatusIntent(undefined);
      setSaveGeneration(value => value + 1);
    }
  };
  const content = {
    adventure: <AdventurePanel game={game} now={now} run={run} intent={adventureIntent} onClose={closePanel} />,
    inventory: <InventoryPanel game={game} run={run} onClose={closePanel} active={activePanel === "inventory"} reports={game.settlements.map(settlement => <SettlementCard key={settlement.id} game={game} settlement={settlement} run={run} />)} />,
    pets: <PetStatusPanel game={game} now={now} run={run} onClose={closePanel} intent={statusIntent} />,
    codex: <CodexPanel game={game} onClose={closePanel} />,
    settings: <SettingsPanel game={game} onReset={resetDemo} onClose={closePanel} active={activePanel === "settings"} activity={<ActivityPanel game={game} />} />,
  };

  return <PetDesktop key={saveGeneration} name={stagePet?.name ?? "宠物"}
    activePanel={activePanel} onOpen={openPanel} onClose={closePanel}
    pending={!!attentionExpedition || pendingTask || pendingPoints} onPending={openPending}
    travel={traveling ? {
      // Identify the segment, not just the expedition: every new destination
      // gets one departure animation, while countdown updates keep the same key.
      departureId: JSON.stringify([traveling.id, traveling.visitedNodeIds.length, traveling.targetNodeId]),
      label: travelingEdge?.label ?? (traveling.travelingEdgeId ? '行进中' : '前往起点'),
      remaining: formatTime(traveling.arriveAt - now),
      progress: 1 - (traveling.arriveAt - now) / Math.max(1, segmentDuration),
    } : undefined}>
    {PET_MENUS.filter(entry => visitedPanels.includes(entry.id)).map(entry =>
      <div key={entry.id} hidden={activePanel !== entry.id}>
        <FloatingWindow panel={entry.id}>{content[entry.id]}</FloatingWindow>
      </div>
    )}
    {notice && <div className="desktop-notice" role="alert">{notice}<button aria-label="关闭提示" onClick={() => setNotice(undefined)}>×</button></div>}
  </PetDesktop>;
}
