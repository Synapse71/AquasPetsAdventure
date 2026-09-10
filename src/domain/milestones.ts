export const PLAYER_MILESTONES = [
  {
    id: "opened-adventure",
    label: "打开探险与任务面板",
    description: "查看组队、地图、进行中的探险与账号任务。",
  },
  {
    id: "opened-inventory",
    label: "打开库存面板",
    description: "查看背包、仓库和撤离战报。",
  },
  {
    id: "opened-pets",
    label: "打开宠物状态面板",
    description: "查看宠物状态、属性、伤势与特质。",
  },
  {
    id: "opened-codex",
    label: "打开图鉴面板",
    description: "查看已经登记的物品图鉴。",
  },
  {
    id: "opened-settings",
    label: "打开设置面板",
    description: "查看 Demo 设置与存档工具。",
  },
] as const;

export type PlayerMilestoneId = (typeof PLAYER_MILESTONES)[number]["id"];

export const PLAYER_MILESTONE_LABELS: Record<PlayerMilestoneId, string> =
  Object.fromEntries(
    PLAYER_MILESTONES.map((milestone) => [milestone.id, milestone.label]),
  ) as Record<PlayerMilestoneId, string>;

const PLAYER_MILESTONE_ID_SET = new Set<string>(
  PLAYER_MILESTONES.map((milestone) => milestone.id),
);

export function isPlayerMilestoneId(value: unknown): value is PlayerMilestoneId {
  return typeof value === "string" && PLAYER_MILESTONE_ID_SET.has(value);
}
