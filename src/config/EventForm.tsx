import { useState } from "react";
import {
  SECONDARY_STAT_KEYS,
  SECONDARY_STAT_LABELS,
  STAT_LABELS,
} from "../domain/engine";
import { itemTagLabel } from "../domain/itemTags";
import { RARITY_LABELS } from "../domain/rarity";
import type {
  Catalog,
  Inventory,
  SecondaryRequirement,
  SecondaryStatKey,
  StatKey,
} from "../domain/types";

type Record_ = Record<string, unknown>;

const STAT_KEYS: StatKey[] = ["fitness", "perception", "technique"];

function isRecord(value: unknown): value is Record_ {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
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

function SecondaryGateEditor({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description: string;
  value: unknown;
  onChange: (next: SecondaryRequirement | undefined) => void;
}) {
  const enabled = isRecord(value);
  const rawStat = enabled && typeof value.stat === "string" ? value.stat : "lore";
  const stat = SECONDARY_STAT_KEYS.includes(rawStat as SecondaryStatKey)
    ? (rawStat as SecondaryStatKey)
    : "lore";
  const amount = enabled ? integer(value.value, 1) : 1;

  return (
    <section className="config-event-gate">
      <label className="config-check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) =>
            onChange(
              event.target.checked ? { stat: "lore", value: 1 } : undefined,
            )
          }
        />
        <span>{title}</span>
        <small>{description}</small>
      </label>
      {enabled && (
        <div className="config-field-row">
          <label className="config-field">
            <span>次要属性</span>
            <select
              value={stat}
              onChange={(event) =>
                onChange({
                  stat: event.target.value as SecondaryStatKey,
                  value: amount,
                })
              }
            >
              {SECONDARY_STAT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {SECONDARY_STAT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="config-field">
            <span>最低值</span>
            <input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(event) =>
                onChange({ stat, value: Math.floor(Number(event.target.value)) })
              }
            />
          </label>
        </div>
      )}
    </section>
  );
}

function nextChoiceId(choices: Record_[]): string {
  const used = new Set(
    choices.flatMap((choice) =>
      typeof choice.id === "string" ? [choice.id] : [],
    ),
  );
  let index = 1;
  while (used.has(`choice-${index}`)) index += 1;
  return `choice-${index}`;
}

type ResolutionType = "primary" | "secondary" | "leave";

function resolutionValue(choice: Record_): Record_ {
  if (isRecord(choice.resolution)) return choice.resolution;
  return {
    type: "primary",
    stat: STAT_KEYS.includes(choice.stat as StatKey)
      ? choice.stat
      : "perception",
    difficulty: integer(choice.difficulty, 1),
  };
}

export function EventForm({
  record,
  catalog,
  onChange,
}: {
  record: Record_;
  catalog: Catalog;
  onChange: (next: Record_) => void;
}) {
  const choices = Array.isArray(record.choices)
    ? record.choices.map((choice, index) =>
        isRecord(choice)
          ? choice
          : {
              id: `choice-${index + 1}`,
              label: "待修复选项",
              description: "",
              resolution: {
                type: "primary",
                stat: "perception",
                difficulty: 3,
              },
              rewards: {},
            },
      )
    : [];

  function updateRecord(patch: Record_): void {
    onChange({ ...record, ...patch });
  }

  function updateChoice(index: number, patch: Record_): void {
    updateRecord({
      choices: choices.map((choice, choiceIndex) =>
        choiceIndex === index ? { ...choice, ...patch } : choice,
      ),
    });
  }

  function setOptionalChoiceField(
    index: number,
    key: string,
    value: unknown,
  ): void {
    const next = { ...choices[index] };
    const emptyObject = isRecord(value) && !Object.keys(value).length;
    if (value === undefined || emptyObject || value === "") delete next[key];
    else next[key] = value;
    updateRecord({
      choices: choices.map((choice, i) => (i === index ? next : choice)),
    });
  }

  function setChoiceResolution(index: number, resolution: Record_): void {
    const next: Record_ = { ...choices[index], resolution };
    delete next.stat;
    delete next.difficulty;
    delete next.requiredSecondary;
    if (resolution.type === "leave") {
      delete next.requiredTagId;
      delete next.bonusRewards;
      next.rewards = {};
    }
    updateRecord({
      choices: choices.map((choice, i) => (i === index ? next : choice)),
    });
  }

  function changeResolutionType(index: number, type: ResolutionType): void {
    if (type === "primary") {
      setChoiceResolution(index, {
        type,
        stat: "perception",
        difficulty: 3,
      });
    } else if (type === "secondary") {
      setChoiceResolution(index, {
        type,
        stat: "lore",
        successThreshold: 3,
        extraSuccessThreshold: 5,
      });
    } else {
      setChoiceResolution(index, { type });
    }
  }

  function moveChoice(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= choices.length) return;
    const next = [...choices];
    [next[index], next[target]] = [next[target], next[index]];
    updateRecord({ choices: next });
  }

  function addChoice(): void {
    updateRecord({
      choices: [
        ...choices,
        {
          id: nextChoiceId(choices),
          label: "新选项",
          description: "",
          resolution: {
            type: "primary",
            stat: "perception",
            difficulty: 3,
          },
          rewards: {},
        },
      ],
    });
  }

  return (
    <div className="config-form config-event-form">
      <label className="config-field">
        <span>事件名称</span>
        <input
          value={typeof record.title === "string" ? record.title : ""}
          onChange={(event) => updateRecord({ title: event.target.value })}
          placeholder="玩家看到的事件标题"
        />
      </label>
      <label className="config-field">
        <span>事件描述</span>
        <textarea
          rows={4}
          value={typeof record.description === "string" ? record.description : ""}
          onChange={(event) => updateRecord({ description: event.target.value })}
          placeholder="事件发生了什么"
        />
      </label>

      <SecondaryGateEditor
        title="设置事件抽取门槛"
        description="不达标时，这个事件不进入节点随机池；地图情报会显示所需次要属性。"
        value={record.requiredSecondary}
        onChange={(next) => {
          const updated = { ...record };
          if (next) updated.requiredSecondary = next;
          else delete updated.requiredSecondary;
          onChange(updated);
        }}
      />

      <section className="config-event-outcomes">
        <strong>三类选项结算规则</strong>
        <div>
          <span>主属性</span>
          <small>掷骰，可能出现大成功、成功、失败和大失败</small>
          <span>次要属性</span>
          <small>低于成功门槛置灰；达标后只会成功或大成功</small>
          <span>直接离开</span>
          <small>始终可选，无检定、无奖励、无损失</small>
        </div>
      </section>

      <div className="config-task-heading config-event-choice-heading">
        <div>
          <strong>事件选项</strong>
          <small>玩家选择后立即进行属性检定；每个事件至少保留一个选项。</small>
        </div>
        <button type="button" onClick={addChoice}>
          ＋ 新增选项
        </button>
      </div>

      {choices.map((choice, index) => {
        const resolution = resolutionValue(choice);
        const resolutionType =
          resolution.type === "secondary" || resolution.type === "leave"
            ? resolution.type
            : "primary";
        const primaryStat = STAT_KEYS.includes(resolution.stat as StatKey)
          ? (resolution.stat as StatKey)
          : "perception";
        const secondaryStat = SECONDARY_STAT_KEYS.includes(
          resolution.stat as SecondaryStatKey,
        )
          ? (resolution.stat as SecondaryStatKey)
          : "lore";
        const successThreshold = integer(resolution.successThreshold, 3);
        const extraSuccessThreshold = integer(
          resolution.extraSuccessThreshold,
          successThreshold + 2,
        );
        const tagId = typeof choice.requiredTagId === "string"
          ? choice.requiredTagId
          : "";
        return (
          <section
            className="config-event-choice"
            key={`${index}-${String(choice.id)}`}
          >
            <header>
              <div>
                <strong>
                  {typeof choice.label === "string"
                    ? choice.label
                    : `选项 ${index + 1}`}
                </strong>
                <code>
                  {typeof choice.id === "string" ? choice.id : "缺少 ID"}
                </code>
              </div>
              <div className="config-event-choice-actions">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => moveChoice(index, -1)}
                >
                  上移
                </button>
                <button
                  type="button"
                  disabled={index === choices.length - 1}
                  onClick={() => moveChoice(index, 1)}
                >
                  下移
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={choices.length <= 1}
                  onClick={() =>
                    updateRecord({
                      choices: choices.filter((_, i) => i !== index),
                    })
                  }
                >
                  删除
                </button>
              </div>
            </header>

            <div className="config-field-row">
              <label className="config-field">
                <span>选项 ID</span>
                <input
                  value={typeof choice.id === "string" ? choice.id : ""}
                onChange={(event) =>
                  updateChoice(index, { id: event.target.value })
                }
                />
              </label>
              <label className="config-field">
                <span>选项文本</span>
                <input
                  value={typeof choice.label === "string" ? choice.label : ""}
                  onChange={(event) =>
                    updateChoice(index, { label: event.target.value })
                  }
                />
              </label>
            </div>
            <label className="config-field">
              <span>选项说明</span>
              <textarea
                rows={2}
                value={
                  typeof choice.description === "string"
                    ? choice.description
                    : ""
                }
                onChange={(event) =>
                  updateChoice(index, { description: event.target.value })
                }
              />
            </label>

            <label className="config-field">
              <span>结算类型</span>
              <select
                value={resolutionType}
                onChange={(event) =>
                  changeResolutionType(
                    index,
                    event.target.value as ResolutionType,
                  )
                }
              >
                <option value="primary">主属性检定</option>
                <option value="secondary">次要属性判定</option>
                <option value="leave">直接离开</option>
              </select>
            </label>

            {resolutionType === "primary" && (
              <div className="config-field-row">
                <label className="config-field">
                  <span>检定主属性</span>
                  <select
                    value={primaryStat}
                    onChange={(event) =>
                      setChoiceResolution(index, {
                        ...resolution,
                        type: "primary",
                        stat: event.target.value,
                      })
                    }
                  >
                    {STAT_KEYS.map((key) => (
                      <option value={key} key={key}>
                        {STAT_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="config-field">
                  <span>难度</span>
                  <input
                    type="number"
                    step="1"
                    value={integer(resolution.difficulty, 3)}
                    onChange={(event) =>
                      setChoiceResolution(index, {
                        ...resolution,
                        type: "primary",
                        stat: primaryStat,
                        difficulty: Math.floor(Number(event.target.value)),
                      })
                    }
                  />
                  <small>
                    大成功获得两组奖励；大失败使随机可行动宠物伤势 +1
                  </small>
                </label>
              </div>
            )}

            {resolutionType === "secondary" && (
              <div className="config-event-secondary-resolution">
                <div className="config-field-row triple">
                  <label className="config-field">
                    <span>次要属性</span>
                    <select
                      value={secondaryStat}
                      onChange={(event) =>
                        setChoiceResolution(index, {
                          ...resolution,
                          type: "secondary",
                          stat: event.target.value,
                          successThreshold,
                          extraSuccessThreshold,
                        })
                      }
                    >
                      {SECONDARY_STAT_KEYS.map((key) => (
                        <option value={key} key={key}>
                          {SECONDARY_STAT_LABELS[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="config-field">
                    <span>成功门槛</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={successThreshold}
                      onChange={(event) =>
                        setChoiceResolution(index, {
                          ...resolution,
                          type: "secondary",
                          stat: secondaryStat,
                          successThreshold: Math.floor(
                            Number(event.target.value),
                          ),
                          extraSuccessThreshold,
                        })
                      }
                    />
                  </label>
                  <label className="config-field">
                    <span>大成功门槛</span>
                    <input
                      type="number"
                      min="2"
                      step="1"
                      value={extraSuccessThreshold}
                      onChange={(event) =>
                        setChoiceResolution(index, {
                          ...resolution,
                          type: "secondary",
                          stat: secondaryStat,
                          successThreshold,
                          extraSuccessThreshold: Math.floor(
                            Number(event.target.value),
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                <small>
                  属性低于成功门槛时选项置灰；达到大成功门槛时直接获得基础与额外奖励，不掷骰。
                </small>
              </div>
            )}

            {resolutionType === "leave" && (
              <div className="config-event-leave-note">
                这个选项始终可用。选择后不掷骰、不发放奖励，也不会造成伤势或其他损失。
              </div>
            )}

            {resolutionType !== "leave" && (
              <label className="config-field">
                <span>所需宠物 Tag（可选）</span>
                <select
                  value={tagId}
                  onChange={(event) =>
                    setOptionalChoiceField(
                      index,
                      "requiredTagId",
                      event.target.value,
                    )
                  }
                >
                  <option value="">无 Tag 门槛</option>
                  {Object.values(catalog.tags)
                    .sort((left, right) =>
                      left.name.localeCompare(right.name, "zh-CN"),
                    )
                    .map((tag) => (
                      <option value={tag.id} key={tag.id}>
                        {tag.name}（{tag.id}）
                      </option>
                    ))}
                </select>
                <small>缺少 Tag 时选项置灰，不会让整个事件消失。</small>
              </label>
            )}

            {resolutionType !== "leave" && (
              <div className="config-event-reward-grid">
                <InventoryEditor
                  title="事件奖励"
                  description="成功和大成功都会获得。允许留空。"
                  value={choice.rewards}
                  catalog={catalog}
                  onChange={(next) => updateChoice(index, { rewards: next })}
                />
                <InventoryEditor
                  title="额外奖励"
                  description="只有大成功获得，会和事件奖励叠加。"
                  value={choice.bonusRewards}
                  catalog={catalog}
                  onChange={(next) =>
                    setOptionalChoiceField(index, "bonusRewards", next)
                  }
                />
              </div>
            )}
          </section>
        );
      })}
      {!choices.length && (
        <p className="config-form-note">当前事件没有选项。点击“新增选项”后才能通过发布校验。</p>
      )}
    </div>
  );
}
