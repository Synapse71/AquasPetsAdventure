import { useState } from "react";
import {
  DAILY_GACHA_ID,
  estimateMapIncome,
  expectedGachaPrize,
  paidDrawPrice,
  suggestGachaBudget,
} from "../domain/gacha";
import { RARITIES, RARITY_LABELS } from "../domain/rarity";
import type { Catalog, GachaDefinition, GachaPrizeKind } from "../domain/types";

type Record_ = Record<string, unknown>;

const KIND_LABELS: Record<GachaPrizeKind, string> = { currency: "金币", xp: "经验", item: "道具" };

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// 表单只读写已知字段；缺字段时按 0 / 空显示，最终仍由 validateCatalog 把关。
function asDefinition(record: Record_): GachaDefinition {
  const object = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record_) : {});
  const price = object(record.paidPrice);
  const weights = object(record.prizeWeights);
  const currency = object(record.currency);
  const xp = object(record.xp);
  return {
    id: String(record.id ?? ""),
    name: String(record.name ?? ""),
    resetHour: num(record.resetHour),
    dailyFreeDraws: num(record.dailyFreeDraws),
    paidPrice: { base: num(price.base), growth: num(price.growth, 1) },
    prizeWeights: { currency: num(weights.currency), xp: num(weights.xp), item: num(weights.item) },
    currency: { multiplier: num(currency.multiplier), spread: num(currency.spread) },
    xp: { multiplier: num(xp.multiplier), spread: num(xp.spread) },
    itemRarityWeights: object(record.itemRarityWeights) as GachaDefinition["itemRarityWeights"],
    itemPool: Array.isArray(record.itemPool) ? (record.itemPool as GachaDefinition["itemPool"]) : [],
    budgetAnchorMinutes: num(record.budgetAnchorMinutes),
    budgets: object(record.budgets) as GachaDefinition["budgets"],
  };
}

function NumberField({
  label,
  hint,
  value,
  step = 1,
  min = 0,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="config-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function GachaForm({
  record,
  catalog,
  onChange,
}: {
  record: Record_;
  catalog: Catalog;
  onChange: (next: Record_) => void;
}) {
  const [query, setQuery] = useState("");
  const gacha = asDefinition(record);
  const set = (patch: Partial<GachaDefinition>) => onChange({ ...record, ...patch });
  const maps = Object.values(catalog.maps).sort((a, b) => a.number - b.number);
  const poolIds = new Set(gacha.itemPool.map((entry) => entry.itemId));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = normalizedQuery
    ? Object.values(catalog.items)
        .filter((item) => !poolIds.has(item.id))
        .filter((item) => `${item.name} ${item.id} ${RARITY_LABELS[item.rarity]}`.toLocaleLowerCase().includes(normalizedQuery))
        .slice(0, 30)
    : [];
  const rarityTotal = RARITIES.reduce((sum, rarity) => sum + Math.max(0, gacha.itemRarityWeights[rarity] ?? 0), 0);

  function recalculateBudgets(): void {
    set({
      budgets: Object.fromEntries(
        maps.map((map) => [map.id, suggestGachaBudget(map, gacha.budgetAnchorMinutes, catalog)]),
      ),
    });
  }

  return (
    <div className="config-form config-gacha-form">
      {gacha.id !== DAILY_GACHA_ID && (
        <p className="config-form-note">游戏目前只读取 ID 为「{DAILY_GACHA_ID}」的这一条作为每日扭蛋。</p>
      )}
      <div className="config-field-row triple">
        <label className="config-field">
          <span>名称</span>
          <input value={gacha.name} onChange={(event) => set({ name: event.target.value })} />
        </label>
        <NumberField label="每日重置整点" hint="本地时间 0～23 点" value={gacha.resetHour} max={23} onChange={(resetHour) => set({ resetHour })} />
        <NumberField label="每日免费次数" hint="错过的天数不累积" value={gacha.dailyFreeDraws} onChange={(dailyFreeDraws) => set({ dailyFreeDraws })} />
      </div>

      <section className="config-task-block">
        <div className="config-loot-section-title">
          <div>
            <span>付费价格</span>
            <small>第 n 次付费 = 初始价格 × 倍率^(n-1)，每天重置。前 5 次：{[1, 2, 3, 4, 5].map((index) => paidDrawPrice(gacha, index)).join(" → ")} 金币。</small>
          </div>
        </div>
        <div className="config-field-row">
          <NumberField label="初始价格（金币）" step={10} value={gacha.paidPrice.base} onChange={(base) => set({ paidPrice: { ...gacha.paidPrice, base } })} />
          <NumberField label="倍率" step={0.1} min={1} value={gacha.paidPrice.growth} onChange={(growth) => set({ paidPrice: { ...gacha.paidPrice, growth } })} />
        </div>
      </section>

      <section className="config-task-block">
        <div className="config-loot-section-title">
          <div>
            <span>奖励类别</span>
            <small>一颗蛋只开出一类奖励。金币与经验在「预算 × 倍率」上下按浮动比例均匀取值。</small>
          </div>
        </div>
        <div className="config-field-row triple">
          {(["currency", "xp", "item"] as const).map((kind) => (
            <NumberField
              key={kind}
              label={`${KIND_LABELS[kind]}权重`}
              value={gacha.prizeWeights[kind]}
              onChange={(weight) => set({ prizeWeights: { ...gacha.prizeWeights, [kind]: weight } })}
            />
          ))}
        </div>
        <div className="config-field-row">
          {(["currency", "xp"] as const).map((kind) => (
            <div className="config-field-row" key={kind}>
              <NumberField label={`${KIND_LABELS[kind]}倍率`} step={0.1} value={gacha[kind].multiplier} onChange={(multiplier) => set({ [kind]: { ...gacha[kind], multiplier } })} />
              <NumberField label={`${KIND_LABELS[kind]}浮动比例`} step={0.05} max={1} value={gacha[kind].spread} onChange={(spread) => set({ [kind]: { ...gacha[kind], spread } })} />
            </div>
          ))}
        </div>
      </section>

      <section className="config-task-block">
        <div className="config-loot-section-title">
          <div>
            <span>道具稀有度</span>
            <small>先按权重抽档位，再在道具池同档条目里按条目权重抽。道具池里没有条目的档位不会被抽到。</small>
          </div>
        </div>
        <div className="config-gacha-rarity-grid">
          {RARITIES.map((rarity) => (
            <NumberField
              key={rarity}
              label={`${RARITY_LABELS[rarity]}${rarityTotal > 0 ? ` · ${percent(Math.max(0, gacha.itemRarityWeights[rarity] ?? 0) / rarityTotal)}` : ""}`}
              value={gacha.itemRarityWeights[rarity] ?? 0}
              onChange={(weight) => set({ itemRarityWeights: { ...gacha.itemRarityWeights, [rarity]: weight } })}
            />
          ))}
        </div>
      </section>

      <section className="config-task-block">
        <div className="config-loot-section-title">
          <div>
            <span>道具池 · {gacha.itemPool.length} 件</span>
            <small>仓库放不下时，开出的道具进扭蛋页的「待领取」。</small>
          </div>
        </div>
        <div className="config-task-item-list config-gacha-pool">
          {[...gacha.itemPool]
            .sort((a, b) => RARITIES.indexOf(catalog.items[a.itemId]?.rarity ?? "common") - RARITIES.indexOf(catalog.items[b.itemId]?.rarity ?? "common"))
            .map((entry) => {
              const item = catalog.items[entry.itemId];
              return (
                <div className="config-task-item-row" key={entry.itemId}>
                  <div>
                    <strong>{item?.name ?? entry.itemId}</strong>
                    <code>
                      {entry.itemId} · {item ? RARITY_LABELS[item.rarity] : "物品不存在"} · {item?.sellable ? `售价 ${item.sellValue ?? 0}` : "不可出售"}
                    </code>
                  </div>
                  <label>
                    权重
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={entry.weight}
                      onChange={(event) =>
                        set({ itemPool: gacha.itemPool.map((candidate) => (candidate.itemId === entry.itemId ? { ...candidate, weight: Number(event.target.value) } : candidate)) })
                      }
                    />
                  </label>
                  <button type="button" onClick={() => set({ itemPool: gacha.itemPool.filter((candidate) => candidate.itemId !== entry.itemId) })}>
                    删除
                  </button>
                </div>
              );
            })}
        </div>
        <div className="config-loot-search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索物品名称、ID 或稀有度，加入道具池" />
          {normalizedQuery && (
            <div className="config-loot-search-results">
              {matches.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    set({ itemPool: [...gacha.itemPool, { itemId: item.id, weight: 1 }] });
                    setQuery("");
                  }}
                >
                  <strong>{item.name}</strong>
                  <small>{RARITY_LABELS[item.rarity]}</small>
                  <code>{item.id}</code>
                </button>
              ))}
              {!matches.length && <span>没有可添加的匹配物品</span>}
            </div>
          )}
        </div>
      </section>

      <section className="config-task-block">
        <div className="config-loot-section-title">
          <div>
            <span>每日预算（按地图）</span>
            <small>玩家已解锁的最新地图决定开出的金币、经验基准。估算口径：完整路线等概率、背包充足，不计随机事件与首次撤离奖励。</small>
          </div>
          <button type="button" onClick={recalculateBudgets}>
            按地图配置重算
          </button>
        </div>
        <NumberField label="预算锚点（分钟探索收益）" value={gacha.budgetAnchorMinutes} onChange={(budgetAnchorMinutes) => set({ budgetAnchorMinutes })} />
        <table className="config-gacha-table">
          <thead>
            <tr>
              <th>地图</th>
              <th>估算收益/小时</th>
              <th>金币预算</th>
              <th>经验预算</th>
              <th>单抽期望（金币 / 经验 / 道具售价）</th>
            </tr>
          </thead>
          <tbody>
            {maps.map((map) => {
              const income = estimateMapIncome(map, catalog);
              const hours = income.durationMs / 3_600_000;
              const budget = gacha.budgets[map.id] ?? { currency: 0, xp: 0 };
              const expected = expectedGachaPrize(gacha, budget, catalog);
              const setBudget = (patch: Partial<typeof budget>) => set({ budgets: { ...gacha.budgets, [map.id]: { ...budget, ...patch } } });
              return (
                <tr key={map.id}>
                  <td>
                    {map.name}
                    <code>{map.id}</code>
                  </td>
                  <td>{hours > 0 ? `${Math.round(income.value / hours)} 金币当量 · ${(income.xp / hours).toFixed(1)} 经验` : "无完整路线"}</td>
                  <td>
                    <input type="number" min="0" value={budget.currency} onChange={(event) => setBudget({ currency: Number(event.target.value) })} />
                  </td>
                  <td>
                    <input type="number" min="0" value={budget.xp} onChange={(event) => setBudget({ xp: Number(event.target.value) })} />
                  </td>
                  <td>
                    {(["currency", "xp", "item"] as const)
                      .map((kind) => `${percent(expected.probability[kind])} × ${Math.round(expected[kind])}`)
                      .join(" / ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
