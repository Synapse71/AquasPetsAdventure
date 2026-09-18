import { useState } from "react";
import {
  roundWeight,
  secondaryStatCap,
  SECONDARY_STAT_KEYS,
  SECONDARY_STAT_LABELS,
  STAT_LABELS,
} from "../domain/engine";
import {
  ITEM_TAGS,
  ITEM_TAG_LABELS,
  isKnownItemTag,
} from "../domain/itemTags";
import {
  RARITIES,
  RARITY_COLOR_NAMES,
  RARITY_LABELS,
  rarityRank,
} from "../domain/rarity";
import type { Rarity } from "../domain/rarity";
import type { Catalog, SecondaryStatKey, StatKey } from "../domain/types";
import { lootIconUrl } from "../ui/lootIcons";

type Record_ = Record<string, unknown>;

interface FormState {
  name: string;
  rarity: Rarity;
  weight: string;
  stackSize: string;
  sellable: boolean;
  sellValue: string;
  description: string;
  tags: string[];
  tagGrantId: string;
  secondaryStat: SecondaryStatKey | "";
  secondaryAmount: string;
  foodStat: StatKey | "";
  foodAmount: string;
  foodHealSteps: string;
}

const DESCRIPTION_RANK = rarityRank("legendary");
// 食物只能加主属性。次要属性是硬门槛，食物能抬高门槛就等于食物是钥匙，
// 那它会变回「为了过那扇门必须刷食物」的必需品（系统设计 9.3 不变量 1）。
const MAIN_STAT_KEYS: StatKey[] = ["fitness", "perception", "technique"];
// 伤势只有三档，所以最多回 2 档。
const HEAL_STEP_OPTIONS = ["", "1", "2"] as const;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberText(value: unknown): string {
  return typeof value === "number" ? String(value) : "";
}

function toNumber(value: string, fallback = 0): number {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : fallback;
}

function toForm(record: Record_): FormState {
  const rarity = record.rarity;
  const grant = record.secondaryGrant;
  const grantStat =
    isRecord(grant) && SECONDARY_STAT_KEYS.includes(grant.stat as SecondaryStatKey)
      ? (grant.stat as SecondaryStatKey)
      : "";
  return {
    name: text(record.name),
    rarity: RARITIES.includes(rarity as Rarity) ? (rarity as Rarity) : "common",
    weight: numberText(record.weight),
    stackSize: numberText(record.stackSize),
    sellable: record.sellable === true,
    sellValue: numberText(record.sellValue),
    description: text(record.description),
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    tagGrantId: text(record.tagGrantId),
    secondaryStat: grantStat,
    secondaryAmount: isRecord(grant) ? numberText(grant.amount) : "",
    foodStat:
      isRecord(record.foodBuff) &&
      MAIN_STAT_KEYS.includes(record.foodBuff.stat as StatKey)
        ? (record.foodBuff.stat as StatKey)
        : "",
    foodAmount: isRecord(record.foodBuff) ? numberText(record.foodBuff.amount) : "",
    foodHealSteps: isRecord(record.foodHeal) ? numberText(record.foodHeal.steps) : "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// 只覆盖表单管到的字段，其余键原样保留，避免表单吃掉它不认识的数据。
function toRecord(form: FormState, base: Record_): Record_ {
  const next: Record_ = { ...base };
  next.name = form.name;
  next.rarity = form.rarity;
  next.weight = toNumber(form.weight);

  // 默认一件一格，所以 1 和留空都不写字段，保持记录干净。
  const stackSize = Math.floor(toNumber(form.stackSize, 1));
  if (stackSize > 1) next.stackSize = stackSize;
  else delete next.stackSize;

  // sellable 是必填的独立字段；不可出售时把价格字段删掉，
  // 免得留下一个永远用不到又会误导人的数字。
  next.sellable = form.sellable;
  if (form.sellable) next.sellValue = toNumber(form.sellValue);
  else delete next.sellValue;

  // 内容约定：传说以下不写描述，降档时直接把字段清掉。
  if (rarityRank(form.rarity) >= DESCRIPTION_RANK && form.description.trim()) {
    next.description = form.description;
  } else {
    delete next.description;
  }

  // 没有标签时不留空数组，保持记录干净。
  if (form.tags.length) next.tags = [...form.tags];
  else delete next.tags;

  if (form.tagGrantId) next.tagGrantId = form.tagGrantId;
  else delete next.tagGrantId;

  // 加成写在物品上，不由稀有度推导：没选属性就整个删掉字段，
  // 否则「漏配」和「刻意不是成长道具」在数据上分不出来。
  if (form.secondaryStat) {
    next.secondaryGrant = {
      stat: form.secondaryStat,
      amount: Math.max(1, Math.floor(toNumber(form.secondaryAmount, 1))),
    };
  } else {
    delete next.secondaryGrant;
  }

  // 食物的两种效果互相独立，各自「没配就删字段」——同样为了让「漏配」和
  // 「刻意没有这个效果」在数据上分得出来。
  if (form.foodStat) {
    next.foodBuff = {
      stat: form.foodStat,
      amount: Math.max(1, Math.floor(toNumber(form.foodAmount, 1))),
    };
  } else {
    delete next.foodBuff;
  }
  if (form.foodHealSteps) {
    next.foodHeal = {
      steps: Math.min(2, Math.max(1, Math.floor(toNumber(form.foodHealSteps, 1)))),
    };
  } else {
    delete next.foodHeal;
  }

  return next;
}

export function ItemForm({
  record,
  catalog,
  onChange,
}: {
  record: Record_;
  catalog: Catalog;
  onChange: (next: Record_) => void;
}) {
  const recordId = text(record.id);
  const [form, setForm] = useState<FormState>(() => toForm(record));
  const [loadedId, setLoadedId] = useState(recordId);
  const [customTag, setCustomTag] = useState("");

  // 切换记录时，父组件的 selectedId 会先变，editorText 要等一个 effect 才跟上。
  // 只靠 key 重挂载会在那一帧读到上一条记录的 JSON，导致表单永远慢一拍，
  // 一旦此时改动字段就会把上一条的数据写进当前记录。这里按记录 id 兜住。
  if (recordId !== loadedId) {
    setLoadedId(recordId);
    setForm(toForm(record));
  }

  function update(patch: Partial<FormState>): void {
    const next = { ...form, ...patch };
    setForm(next);
    onChange(toRecord(next, record));
  }

  const needsDescription = rarityRank(form.rarity) >= DESCRIPTION_RANK;
  const weight = toNumber(form.weight);
  // 决定「负重和格子谁先卡住玩家」的是这个乘积，不是单件重量。
  const stackSize = Math.max(1, Math.floor(toNumber(form.stackSize, 1)));
  const ratio =
    form.sellable && weight > 0
      ? (toNumber(form.sellValue) / weight).toFixed(1)
      : "—";
  const tags = Object.values(catalog.tags);
  const growthMode = form.tagGrantId
    ? "tag"
    : form.secondaryStat
      ? "secondary"
      : "none";

  const iconUrl = lootIconUrl(recordId);

  return (
    <div className="config-form">
      <div className="config-icon-preview">
        {iconUrl ? (
          <img src={iconUrl} alt={form.name} />
        ) : (
          <span className="empty">缺图标</span>
        )}
        <small>
          {iconUrl
            ? `assets/loot/icons/…/${recordId}.png`
            : `未找到 ${recordId}.png`}
        </small>
      </div>

      <label className="config-field">
        <span>名称</span>
        <input
          value={form.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="显示名"
        />
      </label>

      <label className="config-field">
        <span>稀有度</span>
        <select
          className={`config-rarity rarity-${form.rarity}`}
          value={form.rarity}
          onChange={(event) =>
            update({ rarity: event.target.value as Rarity })
          }
        >
          {RARITIES.map((rarity) => (
            <option key={rarity} value={rarity}>
              {RARITY_COLOR_NAMES[rarity]} · {RARITY_LABELS[rarity]}
            </option>
          ))}
        </select>
      </label>

      <div className="config-field-row triple">
        <label className="config-field">
          <span>重量</span>
          <input
            type="number"
            step="0.1"
            min="0"
            value={form.weight}
            onChange={(event) => update({ weight: event.target.value })}
            onBlur={() =>
              update({ weight: String(roundWeight(toNumber(form.weight))) })
            }
          />
          <small>下限 0，最小粒度 0.1（1 点 ≈ 0.2 kg）</small>
        </label>

        <label className="config-field">
          <span>每格堆叠</span>
          <input
            type="number"
            step="1"
            min="1"
            value={form.stackSize}
            placeholder="1"
            onChange={(event) => update({ stackSize: event.target.value })}
          />
          <small>
            留空或 1 表示一件占一格，不写入字段
            <br />
            每格满载 {roundWeight(weight * stackSize)} 负重
          </small>
        </label>

        <label className="config-field">
          <span>出售价值</span>
          <input
            type="number"
            min="0"
            value={form.sellable ? form.sellValue : ""}
            disabled={!form.sellable}
            onChange={(event) => update({ sellValue: event.target.value })}
          />
          <small>值重比 {ratio}</small>
        </label>
      </div>

      <label className="config-check">
        <input
          type="checkbox"
          checked={form.sellable}
          onChange={(event) => update({ sellable: event.target.checked })}
        />
        <span>可出售</span>
        <small>取消勾选后移除 sellValue 字段，物品变为不可出售</small>
      </label>

      <div className="config-field">
        <span>标签</span>
        <div className="config-tag-picker">
          {ITEM_TAGS.map((tag) => (
            <label
              className={form.tags.includes(tag) ? "active" : ""}
              key={tag}
            >
              <input
                type="checkbox"
                checked={form.tags.includes(tag)}
                onChange={(event) =>
                  update({
                    tags: event.target.checked
                      ? [...form.tags, tag]
                      : form.tags.filter((value) => value !== tag),
                  })
                }
              />
              {ITEM_TAG_LABELS[tag]}
            </label>
          ))}
          {form.tags
            .filter((tag) => !isKnownItemTag(tag))
            .map((tag) => (
              <button
                className="custom"
                key={tag}
                title="点击移除"
                onClick={() =>
                  update({ tags: form.tags.filter((v) => v !== tag) })
                }
              >
                {tag} ×
              </button>
            ))}
        </div>
        <input
          value={customTag}
          placeholder="自定义标签，回车添加"
          onChange={(event) => setCustomTag(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const value = customTag.trim();
            if (!value || form.tags.includes(value)) return;
            update({ tags: [...form.tags, value] });
            setCustomTag("");
          }}
        />
        <small>一件物品可以有多个标签，也可以没有</small>
      </div>

      <div className="config-growth-effect">
        <div className="config-growth-title">
          <div>
            <strong>使用后永久效果</strong>
            <small>两种成长效果互斥；使用后物品都会消失。</small>
          </div>
          <span>
            {growthMode === "tag"
              ? "赋予 Tag"
              : growthMode === "secondary"
                ? "增加次要属性"
                : "无成长效果"}
          </span>
        </div>

        <div className="config-growth-modes" role="group" aria-label="物品使用效果">
          <button
            type="button"
            className={growthMode === "none" ? "active" : ""}
            onClick={() => update({ tagGrantId: "", secondaryStat: "" })}
          >
            <strong>无效果</strong>
            <small>普通物品</small>
          </button>
          <button
            type="button"
            className={growthMode === "tag" ? "active" : ""}
            disabled={!tags.length}
            onClick={() =>
              update({
                tagGrantId: form.tagGrantId || tags[0]?.id || "",
                secondaryStat: "",
              })
            }
          >
            <strong>赋予 Tag</strong>
            <small>永久特质</small>
          </button>
          <button
            type="button"
            className={growthMode === "secondary" ? "active" : ""}
            onClick={() =>
              update({
                tagGrantId: "",
                secondaryStat: form.secondaryStat || "lore",
                secondaryAmount: form.secondaryAmount || "1",
              })
            }
          >
            <strong>增加次要属性</strong>
            <small>口才／学识／勇气／诡计</small>
          </button>
        </div>

        {growthMode === "tag" && (
          <label className="config-field">
            <span>赋予宠物 Tag</span>
            <select
              value={form.tagGrantId}
              onChange={(event) =>
                update({
                  tagGrantId: event.target.value,
                  secondaryStat: "",
                })
              }
            >
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}（{tag.id}）
                </option>
              ))}
            </select>
            <small>使用后永久绑定该 Tag。Tag 成长道具按设计不可出售。</small>
          </label>
        )}

        {growthMode === "secondary" && (
          <div className="config-field-row">
            <label className="config-field">
              <span>增加哪项次要属性</span>
              <select
                value={form.secondaryStat}
                onChange={(event) =>
                  update({
                    secondaryStat: event.target.value as SecondaryStatKey,
                    secondaryAmount: form.secondaryAmount || "1",
                  })
                }
              >
                {SECONDARY_STAT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {SECONDARY_STAT_LABELS[key]}
                  </option>
                ))}
              </select>
              <small>使用后永久提升该属性；这类成长道具仍然可以出售。</small>
            </label>

            <label className="config-field">
              <span>增加点数</span>
              <input
                type="number"
                step="1"
                min="1"
                value={form.secondaryAmount}
                onChange={(event) =>
                  update({ secondaryAmount: event.target.value })
                }
              />
              <small>
                显式配置，不由稀有度自动推导。当前次要属性上限为
                {secondaryStatCap()}。
              </small>
            </label>
          </div>
        )}
      </div>

      <div className="config-growth-effect">
        <div className="config-growth-title">
          <div>
            <strong>食物效果</strong>
            <small>
              两种效果互相独立，可以只配一种、也可以都配。配了就能被吃掉，
              而<b>吃掉就卖不成钱</b>——卖还是吃由玩家自己权衡。
            </small>
          </div>
          <span>
            {form.foodStat || form.foodHealSteps
              ? [
                  form.foodStat && `${STAT_LABELS[form.foodStat]} +${toNumber(form.foodAmount, 1)}`,
                  form.foodHealSteps && `治疗 ${form.foodHealSteps} 档`,
                ].filter(Boolean).join(" · ")
              : "不能吃"}
          </span>
        </div>

        <div className="config-field-row">
          <label className="config-field">
            <span>主属性加成</span>
            <select
              value={form.foodStat}
              onChange={(event) =>
                update({
                  foodStat: event.target.value as StatKey | "",
                  foodAmount: event.target.value ? form.foodAmount || "1" : "",
                })
              }
            >
              <option value="">不加</option>
              {MAIN_STAT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {STAT_LABELS[key]}
                </option>
              ))}
            </select>
            <small>
              只能加主属性。次要属性是硬门槛，食物能抬高门槛就等于食物是钥匙，
              那它会变回必需品（系统设计 9.3）。
            </small>
          </label>

          <label className="config-field">
            <span>加成点数</span>
            <input
              type="number"
              step="1"
              min="1"
              disabled={!form.foodStat}
              value={form.foodAmount}
              onChange={(event) => update({ foodAmount: event.target.value })}
            />
            <small>
              显式配置，不由稀有度推导。同时会抬高负重和格子上限
              （体能 ×1.2 负重，技巧 ×1 格），只加一次，不随队伍人数放大。
            </small>
          </label>
        </div>

        <label className="config-field">
          <span>治疗伤势</span>
          <select
            value={form.foodHealSteps}
            onChange={(event) => update({ foodHealSteps: event.target.value })}
          >
            {HEAL_STEP_OPTIONS.map((steps) => (
              <option key={steps || "none"} value={steps}>
                {steps ? `恢复 ${steps} 档` : "不治疗"}
              </option>
            ))}
          </select>
          <small>
            按档恢复，和自然恢复同粒度（失能 → 受伤 → 正常），最多 2 档。
            治疗立即结算，不占加成的位置。
          </small>
        </label>

        {(form.foodStat || form.foodHealSteps) && !form.tags.includes("food") && (
          <p className="config-form-note config-food-warning">
            配了食物效果却没有「食物」标签。玩家在行前整备里是按标签筛选的，会找不到它。
          </p>
        )}
      </div>

      <label className="config-field">
        <span>描述</span>
        {needsDescription ? (
          <textarea
            className="config-form-text"
            rows={3}
            value={form.description}
            onChange={(event) => update({ description: event.target.value })}
            placeholder="传说及以上需要一句话描述"
          />
        ) : (
          <p className="config-form-note">
            {RARITY_LABELS[form.rarity]}
            档不写描述。升到传说及以上后这里会出现描述输入框。
          </p>
        )}
      </label>
    </div>
  );
}
