import { useState } from "react";
import {
  secondaryStatCap,
  SECONDARY_STAT_KEYS,
  SECONDARY_STAT_LABELS,
  STAT_LABELS,
} from "../domain/engine";
import type {
  Catalog,
  SecondaryStatKey,
  SecondaryStats,
  StatKey,
  Stats,
} from "../domain/types";

type Record_ = Record<string, unknown>;

const STAT_KEYS: StatKey[] = ["fitness", "perception", "technique"];

// 主属性各自的持续机制，写在表单里是为了让策划改数值时看得见后果。
const STAT_EFFECTS: Record<StatKey, string> = {
  fitness: "决定负重上限",
  perception: "决定地图与事件情报等级",
  technique: "决定背包格子上限",
};

interface FormState {
  name: string;
  baseStats: Stats;
  secondaryStats: SecondaryStats;
  growthTagSlots: string;
  innateTagId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function intOf(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
}

function toInt(value: string, fallback = 0): number {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed)
    ? Math.floor(parsed)
    : fallback;
}

function toForm(record: Record_): FormState {
  const base = isRecord(record.baseStats) ? record.baseStats : {};
  const secondary = isRecord(record.secondaryStats) ? record.secondaryStats : {};
  return {
    name: typeof record.name === "string" ? record.name : "",
    baseStats: {
      fitness: intOf(base.fitness, 2),
      perception: intOf(base.perception, 2),
      technique: intOf(base.technique, 2),
    },
    secondaryStats: {
      eloquence: intOf(secondary.eloquence),
      lore: intOf(secondary.lore),
      courage: intOf(secondary.courage),
      guile: intOf(secondary.guile),
    },
    growthTagSlots: String(intOf(record.growthTagSlots, 1)),
    innateTagId: typeof record.innateTagId === "string" ? record.innateTagId : "",
  };
}

// 只覆盖表单管到的字段，其余键原样保留（等级、经验等由存档而不是目录决定）。
function toRecord(form: FormState, base: Record_): Record_ {
  const next: Record_ = { ...base };
  next.name = form.name;
  next.baseStats = { ...form.baseStats };
  next.secondaryStats = { ...form.secondaryStats };
  next.growthTagSlots = Math.max(0, toInt(form.growthTagSlots, 1));
  if (form.innateTagId) next.innateTagId = form.innateTagId;
  else delete next.innateTagId;
  return next;
}

export function PetForm({
  record,
  catalog,
  onChange,
}: {
  record: Record_;
  catalog: Catalog;
  onChange: (next: Record_) => void;
}) {
  const recordId = typeof record.id === "string" ? record.id : "";
  const [form, setForm] = useState<FormState>(() => toForm(record));
  const [loadedId, setLoadedId] = useState(recordId);

  // 与 ItemForm 相同的兜底：切换记录时 editorText 慢一帧，
  // 只靠 key 重挂载会把上一条的数据写进当前记录。
  if (recordId !== loadedId) {
    setLoadedId(recordId);
    setForm(toForm(record));
  }

  function update(patch: Partial<FormState>): void {
    const next = { ...form, ...patch };
    setForm(next);
    onChange(toRecord(next, record));
  }

  const cap = secondaryStatCap();
  const tags = Object.values(catalog.tags);

  return (
    <div className="config-form">
      <label className="config-field">
        <span>名称</span>
        <input
          value={form.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="显示名"
        />
      </label>

      <div className="config-field">
        <span>主属性初始值</span>
        <div className="config-stat-grid">
          {STAT_KEYS.map((key) => (
            <label key={key}>
              <b>{STAT_LABELS[key]}</b>
              <input
                type="number"
                step="1"
                min="0"
                value={form.baseStats[key]}
                onChange={(event) =>
                  update({
                    baseStats: {
                      ...form.baseStats,
                      [key]: Math.max(0, toInt(event.target.value)),
                    },
                  })
                }
              />
              <em>{STAT_EFFECTS[key]}</em>
            </label>
          ))}
        </div>
        <small>玩家用属性点提升这三项，加点当场就能看到变化</small>
      </div>

      <div className="config-field">
        <span>次要属性初始值</span>
        <div className="config-stat-grid">
          {SECONDARY_STAT_KEYS.map((key: SecondaryStatKey) => {
            const value = form.secondaryStats[key];
            return (
              <label key={key}>
                <b>{SECONDARY_STAT_LABELS[key]}</b>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max={cap}
                  value={value}
                  onChange={(event) =>
                    update({
                      secondaryStats: {
                        ...form.secondaryStats,
                        [key]: Math.min(
                          cap,
                          Math.max(0, toInt(event.target.value)),
                        ),
                      },
                    })
                  }
                />
                <em>{value >= cap ? "已达上限" : `上限 ${cap}`}</em>
              </label>
            );
          })}
        </div>
        <small>
          每只宠物都拥有全部四项，靠初始值拉开差距。不能用属性点提升，
          只能靠成长道具，上限统一为 {cap}
        </small>
      </div>

      <div className="config-field-row">
        <label className="config-field">
          <span>先天 Tag</span>
          <select
            value={form.innateTagId}
            onChange={(event) => update({ innateTagId: event.target.value })}
          >
            <option value="">没有先天 Tag</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}（{tag.id}）
              </option>
            ))}
          </select>
          <small>后续宠物各带一个特色，尽量不重复</small>
        </label>

        <label className="config-field">
          <span>可塑造 Tag 槽</span>
          <input
            type="number"
            step="1"
            min="0"
            value={form.growthTagSlots}
            onChange={(event) =>
              update({ growthTagSlots: event.target.value })
            }
          />
          <small>
            先天 + 可塑造合计上限为 2：白板宠物 0+2，后续宠物 1+1
          </small>
        </label>
      </div>
    </div>
  );
}
