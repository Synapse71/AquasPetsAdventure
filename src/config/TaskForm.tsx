import { useState } from "react";
import { RARITY_LABELS } from "../domain/rarity";
import { PLAYER_MILESTONES } from "../domain/milestones";
import { itemTagLabel } from "../domain/itemTags";
import type { Catalog, Inventory } from "../domain/types";

type Record_ = Record<string, unknown>;

function isRecord(value: unknown): value is Record_ {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inventoryValue(value: unknown): Inventory {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([itemId, quantity]) =>
      typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0
        ? [[itemId, quantity]]
        : [],
    ),
  );
}

function InventoryEditor({
  title,
  description,
  value,
  catalog,
  onChange,
}: {
  title: string;
  description: string;
  value: unknown;
  catalog: Catalog;
  onChange: (next: Inventory) => void;
}) {
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const inventory = inventoryValue(value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const availableTags = Array.from(
    new Set(Object.values(catalog.items).flatMap((item) => item.tags ?? [])),
  ).sort((left, right) =>
    itemTagLabel(left).localeCompare(itemTagLabel(right), "zh-CN"),
  );
  const hasFilter = Boolean(normalizedQuery || tagFilter);
  const matches = Object.values(catalog.items)
    .filter((item) => !Object.hasOwn(inventory, item.id))
    .filter((item) => !tagFilter || item.tags?.includes(tagFilter))
    .filter((item) =>
      normalizedQuery
        ? `${item.name} ${item.id} ${RARITY_LABELS[item.rarity]} ${(item.tags ?? []).map(itemTagLabel).join(" ")}`
            .toLocaleLowerCase()
            .includes(normalizedQuery)
        : true,
    )
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
    .slice(0, 30);

  function setQuantity(itemId: string, quantity: number): void {
    const next = { ...inventory };
    if (!Number.isInteger(quantity) || quantity < 1) delete next[itemId];
    else next[itemId] = quantity;
    onChange(next);
  }

  return (
    <section className="config-task-block">
      <div className="config-loot-section-title">
        <div>
          <span>{title}</span>
          <small>{description}</small>
        </div>
      </div>
      {!!Object.keys(inventory).length && (
        <div className="config-task-item-list">
          {Object.entries(inventory).map(([itemId, quantity]) => (
            <div className="config-task-item-row" key={itemId}>
              <div>
                <strong>{catalog.items[itemId]?.name ?? itemId}</strong>
                <code>{itemId}</code>
              </div>
              <label>
                数量
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(itemId, Math.floor(Number(event.target.value)))
                  }
                />
              </label>
              <button type="button" onClick={() => setQuantity(itemId, 0)}>
                删除
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="config-loot-search">
        <div className="config-item-picker-controls">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索物品名称、ID、稀有度或 Tag"
          />
          <select
            aria-label={`${title}按物品 Tag 筛选`}
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
          >
            <option value="">全部 Tag</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>
                {itemTagLabel(tag)}
              </option>
            ))}
          </select>
        </div>
        {hasFilter && (
          <div className="config-loot-search-results">
            {matches.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  onChange({ ...inventory, [item.id]: 1 });
                  setQuery("");
                }}
              >
                <strong>{item.name}</strong>
                <small>
                  {RARITY_LABELS[item.rarity]}
                  {!!item.tags?.length &&
                    ` · ${item.tags.map(itemTagLabel).join("、")}`}
                </small>
                <code>{item.id}</code>
              </button>
            ))}
            {!matches.length && <span>没有可添加的匹配物品</span>}
          </div>
        )}
      </div>
    </section>
  );
}

function IdChecklist({
  title,
  description,
  values,
  options,
  onChange,
}: {
  title: string;
  description: string;
  values: string[];
  options: { id: string; label: string }[];
  onChange: (next: string[]) => void;
}) {
  return (
    <section className="config-task-block">
      <div className="config-loot-section-title">
        <div>
          <span>{title}</span>
          <small>{description}</small>
        </div>
      </div>
      <div className="config-task-check-grid">
        {options.map((option) => (
          <label className="config-check" key={option.id}>
            <input
              type="checkbox"
              checked={values.includes(option.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...values, option.id]
                    : values.filter((id) => id !== option.id),
                )
              }
            />
            <span>{option.label}</span>
            <small>{option.id}</small>
          </label>
        ))}
        {!options.length && <p className="config-form-note">暂无可选记录。</p>}
      </div>
    </section>
  );
}

export function TaskForm({
  record,
  catalog,
  onChange,
}: {
  record: Record_;
  catalog: Catalog;
  onChange: (next: Record_) => void;
}) {
  const requirement = isRecord(record.requirement) ? record.requirement : {};
  const reward = isRecord(record.reward) ? record.reward : {};
  const taskId = typeof record.id === "string" ? record.id : "";
  const prerequisites = Array.isArray(record.prerequisiteTaskIds)
    ? record.prerequisiteTaskIds.filter((id): id is string => typeof id === "string")
    : [];
  const goals = Array.isArray(requirement.goals)
    ? requirement.goals.filter(isRecord)
    : [];
  const goalMapIds = goals.flatMap((goal) =>
        isRecord(goal) && goal.type === "clear-map" && typeof goal.mapId === "string"
          ? [goal.mapId]
          : [],
      );
  const goalMilestoneIds = goals.flatMap((goal) =>
    goal.type === "milestone" && typeof goal.milestoneId === "string"
      ? [goal.milestoneId]
      : [],
  );

  function updateRecord(patch: Record_): void {
    onChange({ ...record, ...patch });
  }

  function updateSection(
    section: "requirement" | "reward",
    key: string,
    value: unknown,
  ): void {
    const current = section === "requirement" ? requirement : reward;
    const next = { ...current };
    const emptyObject = isRecord(value) && !Object.keys(value).length;
    const emptyArray = Array.isArray(value) && !value.length;
    if (value === undefined || emptyObject || emptyArray) delete next[key];
    else next[key] = value;
    updateRecord({ [section]: next });
  }

  function replaceGoals(
    type: "clear-map" | "milestone",
    replacements: Record_[],
  ): void {
    updateSection("requirement", "goals", [
      ...goals.filter((goal) => goal.type !== type),
      ...replacements,
    ]);
  }

  return (
    <div className="config-form config-task-form">
      <label className="config-field">
        <span>任务名称</span>
        <input
          value={typeof record.title === "string" ? record.title : ""}
          onChange={(event) => updateRecord({ title: event.target.value })}
        />
      </label>
      <label className="config-field">
        <span>任务说明</span>
        <textarea
          rows={3}
          value={typeof record.description === "string" ? record.description : ""}
          onChange={(event) => updateRecord({ description: event.target.value })}
        />
      </label>

      <IdChecklist
        title="前置任务"
        description="这里勾选的任务全部完成后，本任务才会出现。"
        values={prerequisites}
        options={Object.values(catalog.tasks)
          .filter((task) => task.id !== taskId)
          .map((task) => ({ id: task.id, label: task.title }))}
        onChange={(next) =>
          updateRecord({ prerequisiteTaskIds: next.length ? next : undefined })
        }
      />

      <div className="config-task-heading">
        <strong>达成条件</strong>
        <small>配置的物品、货币与目标必须全部满足。</small>
      </div>
      <InventoryEditor
        title="提交物品"
        description="完成任务时从仓库实际扣除。"
        value={requirement.items}
        catalog={catalog}
        onChange={(items) => updateSection("requirement", "items", items)}
      />
      <label className="config-check config-task-number-toggle">
        <input
          type="checkbox"
          checked={typeof requirement.currency === "number"}
          onChange={(event) =>
            updateSection("requirement", "currency", event.target.checked ? 1 : undefined)
          }
        />
        <span>提交通用货币</span>
        {typeof requirement.currency === "number" && (
          <input
            aria-label="提交通用货币数量"
            type="number"
            min="1"
            step="1"
            value={requirement.currency}
            onChange={(event) =>
              updateSection(
                "requirement",
                "currency",
                Math.max(1, Math.floor(Number(event.target.value))),
              )
            }
          />
        )}
      </label>
      <IdChecklist
        title="目标：首次通关地图"
        description="第一次成功从该地图任意固定终点撤离；中途节点撤离不算通关。"
        values={goalMapIds}
        options={Object.values(catalog.maps)
          .sort((left, right) => left.number - right.number)
          .map((map) => ({ id: map.id, label: map.name }))}
        onChange={(next) =>
          replaceGoals(
            "clear-map",
            next.map((mapId) => ({ type: "clear-map", mapId })),
          )
        }
      />
      <IdChecklist
        title="目标：玩家里程碑"
        description="玩家首次完成对应操作后永久记录；重复操作不会重复计数。"
        values={goalMilestoneIds}
        options={PLAYER_MILESTONES.map((milestone) => ({
          id: milestone.id,
          label: milestone.label,
        }))}
        onChange={(next) =>
          replaceGoals(
            "milestone",
            next.map((milestoneId) => ({ type: "milestone", milestoneId })),
          )
        }
      />

      <div className="config-task-heading">
        <strong>任务奖励</strong>
        <small>任务不会奖励宠物经验值。</small>
      </div>
      <label className="config-check config-task-number-toggle">
        <input
          type="checkbox"
          checked={typeof reward.currency === "number"}
          onChange={(event) =>
            updateSection("reward", "currency", event.target.checked ? 1 : undefined)
          }
        />
        <span>奖励通用货币</span>
        {typeof reward.currency === "number" && (
          <input
            aria-label="奖励通用货币数量"
            type="number"
            min="1"
            step="1"
            value={reward.currency}
            onChange={(event) =>
              updateSection(
                "reward",
                "currency",
                Math.max(1, Math.floor(Number(event.target.value))),
              )
            }
          />
        )}
      </label>
      <InventoryEditor
        title="奖励物品"
        description="完成时直接进入仓库并登记图鉴。"
        value={reward.items}
        catalog={catalog}
        onChange={(items) => updateSection("reward", "items", items)}
      />
      <IdChecklist
        title="解锁地图"
        description="保留现有账号进程奖励能力。"
        values={Array.isArray(reward.unlockMapIds) ? reward.unlockMapIds.filter((id): id is string => typeof id === "string") : []}
        options={Object.values(catalog.maps).map((map) => ({ id: map.id, label: map.name }))}
        onChange={(next) => updateSection("reward", "unlockMapIds", next)}
      />
      <IdChecklist
        title="解锁宠物"
        description="将宠物模板加入当前存档。"
        values={Array.isArray(reward.addPetIds) ? reward.addPetIds.filter((id): id is string => typeof id === "string") : []}
        options={Object.values(catalog.petTemplates).map((pet) => ({ id: pet.id, label: pet.name }))}
        onChange={(next) => updateSection("reward", "addPetIds", next)}
      />
      <label className="config-check config-task-number-toggle">
        <input
          type="checkbox"
          checked={typeof reward.warehouseSlots === "number"}
          onChange={(event) =>
            updateSection("reward", "warehouseSlots", event.target.checked ? 1 : undefined)
          }
        />
        <span>增加仓库格数</span>
        {typeof reward.warehouseSlots === "number" && (
          <input
            aria-label="增加仓库格数"
            type="number"
            min="1"
            step="1"
            value={reward.warehouseSlots}
            onChange={(event) =>
              updateSection(
                "reward",
                "warehouseSlots",
                Math.max(1, Math.floor(Number(event.target.value))),
              )
            }
          />
        )}
      </label>
    </div>
  );
}
