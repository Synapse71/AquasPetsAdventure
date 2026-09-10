import { useState } from "react";
import {
  SECONDARY_STAT_KEYS,
  SECONDARY_STAT_LABELS,
} from "../domain/engine";
import { itemTagLabel } from "../domain/itemTags";
import { RARITIES, RARITY_COLOR_NAMES, RARITY_LABELS } from "../domain/rarity";
import type { Rarity } from "../domain/rarity";
import type {
  Catalog,
  Inventory,
  LootCompositionDefinition,
  NodeLootDefinition,
} from "../domain/types";

type Record_ = Record<string, unknown>;

function isRecord(value: unknown): value is Record_ {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function intValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
}

function inputNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeLoot(value: unknown): NodeLootDefinition {
  if (isRecord(value) && value.mode === "composition") {
    return {
      mode: "composition",
      minCount: intValue(value.minCount, 3),
      maxCount: intValue(value.maxCount, 5),
      compositions: Array.isArray(value.compositions)
        ? value.compositions.flatMap((entry, index) => {
            if (!isRecord(entry)) return [];
            const rawCounts = isRecord(entry.rarityCounts)
              ? entry.rarityCounts
              : {};
            return [
              {
                id:
                  typeof entry.id === "string"
                    ? entry.id
                    : `composition-${index + 1}`,
                weight:
                  typeof entry.weight === "number" ? entry.weight : 0,
                rarityCounts: Object.fromEntries(
                  RARITIES.map((rarity) => [
                    rarity,
                    typeof rawCounts[rarity] === "number"
                      ? rawCounts[rarity]
                      : 0,
                  ]),
                ),
              },
            ];
          })
        : [],
      whitelistItemIds: Array.isArray(value.whitelistItemIds)
        ? value.whitelistItemIds.filter(
            (itemId): itemId is string => typeof itemId === "string",
          )
        : undefined,
      whitelistItemTags: Array.isArray(value.whitelistItemTags)
        ? value.whitelistItemTags.filter(
            (tag): tag is string => typeof tag === "string",
          )
        : undefined,
      blacklistItemIds: Array.isArray(value.blacklistItemIds)
        ? value.blacklistItemIds.filter(
            (itemId): itemId is string => typeof itemId === "string",
          )
        : undefined,
      blacklistItemTags: Array.isArray(value.blacklistItemTags)
        ? value.blacklistItemTags.filter(
            (tag): tag is string => typeof tag === "string",
          )
        : undefined,
    };
  }
  if (isRecord(value) && value.mode === "independent") {
    const rarityWeights = isRecord(value.rarityWeights)
      ? Object.fromEntries(
          RARITIES.map((rarity) => [
            rarity,
            typeof value.rarityWeights === "object" &&
            value.rarityWeights !== null &&
            typeof (value.rarityWeights as Record_)[rarity] === "number"
              ? (value.rarityWeights as Record_)[rarity]
              : 0,
          ]),
        )
      : { common: 50, uncommon: 30, rare: 15, epic: 5 };
    return {
      mode: "independent",
      minCount: intValue(value.minCount, 3),
      maxCount: intValue(value.maxCount, 5),
      rarityWeights: rarityWeights as Partial<Record<Rarity, number>>,
      countWeights: isRecord(value.countWeights)
        ? (value.countWeights as Record<string, number>)
        : undefined,
      whitelistItemIds: Array.isArray(value.whitelistItemIds)
        ? value.whitelistItemIds.filter(
            (itemId): itemId is string => typeof itemId === "string",
          )
        : undefined,
      whitelistItemTags: Array.isArray(value.whitelistItemTags)
        ? value.whitelistItemTags.filter(
            (tag): tag is string => typeof tag === "string",
          )
        : undefined,
      blacklistItemIds: Array.isArray(value.blacklistItemIds)
        ? value.blacklistItemIds.filter(
            (itemId): itemId is string => typeof itemId === "string",
          )
        : undefined,
      blacklistItemTags: Array.isArray(value.blacklistItemTags)
        ? value.blacklistItemTags.filter(
            (tag): tag is string => typeof tag === "string",
          )
        : undefined,
    };
  }
  return {
    mode: "independent",
    minCount: 3,
    maxCount: 5,
    rarityWeights: { common: 50, uncommon: 30, rare: 15, epic: 5 },
  };
}

function positivePercent(value: number, values: number[]): string {
  const total = values.reduce(
    (sum, current) => sum + (current > 0 ? current : 0),
    0,
  );
  return total > 0 && value > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0%";
}

function integerRange(min: number, max: number): number[] {
  if (min < 1 || max < min || max - min > 100) return [];
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

function ItemListPicker({
  label,
  description,
  selected,
  selectedTags,
  catalog,
  onChange,
  onTagsChange,
}: {
  label: string;
  description: string;
  selected: string[];
  selectedTags: string[];
  catalog: Catalog;
  onChange: (next: string[]) => void;
  onTagsChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const candidates = Object.values(catalog.items)
    .filter((item) => !item.tagGrantId && !selected.includes(item.id))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  const availableTags = [
    ...new Set(
      Object.values(catalog.items).flatMap((item) => item.tags ?? []),
    ),
  ]
    .filter((tag) => !selectedTags.includes(tag))
    .sort((left, right) => itemTagLabel(left).localeCompare(itemTagLabel(right), "zh-CN"));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = normalizedQuery
    ? candidates.filter((item) =>
        [
          item.name,
          item.id,
          RARITY_LABELS[item.rarity],
          RARITY_COLOR_NAMES[item.rarity],
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
    : [];

  function addItem(itemId: string): void {
    if (!itemId || selected.includes(itemId)) return;
    onChange([...selected, itemId]);
    setQuery("");
  }

  return (
    <div className="config-field config-loot-picker">
      <span>{label}</span>
      <small>{description}</small>
      {!!selectedTags.length && (
        <div className="config-loot-chips config-loot-tag-chips">
          {selectedTags.map((tag) => (
            <button
              type="button"
              key={tag}
              onClick={() =>
                onTagsChange(selectedTags.filter((selectedTag) => selectedTag !== tag))
              }
              title="点击移除物品分类 Tag"
            >
              Tag：{itemTagLabel(tag)} <code>{tag}</code> <i>×</i>
            </button>
          ))}
        </div>
      )}
      <select
        className="config-loot-tag-select"
        value=""
        onChange={(event) => {
          if (event.target.value) {
            onTagsChange([...selectedTags, event.target.value]);
          }
        }}
      >
        <option value="">＋ 按物品 Tag 批量选择……</option>
        {availableTags.map((tag) => {
          const count = Object.values(catalog.items).filter((item) =>
            item.tags?.includes(tag),
          ).length;
          return (
            <option key={tag} value={tag}>
              {itemTagLabel(tag)}（{tag} · {count} 件物品）
            </option>
          );
        })}
      </select>
      {!!selected.length && (
        <div className="config-loot-chips">
          {selected.map((itemId) => {
            const item = catalog.items[itemId];
            return (
              <button
                type="button"
                key={itemId}
                onClick={() => onChange(selected.filter((id) => id !== itemId))}
                title="点击移除"
              >
                {item?.name ?? itemId} <i>×</i>
              </button>
            );
          })}
        </div>
      )}
      <div className="config-loot-search">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
            if (event.key === "Enter" && matches.length === 1) {
              event.preventDefault();
              addItem(matches[0].id);
            }
          }}
          placeholder="输入物品名称、ID 或稀有度搜索"
        />
        {normalizedQuery && (
          <div className="config-loot-search-results">
            {!matches.length && <span>没有匹配的可选物品</span>}
            {matches.slice(0, 12).map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => addItem(item.id)}
              >
                <strong>{item.name}</strong>
                <small>
                  {RARITY_COLOR_NAMES[item.rarity]} · {RARITY_LABELS[item.rarity]}
                </small>
                <code>{item.id}</code>
              </button>
            ))}
            {matches.length > 12 && (
              <span>还有 {matches.length - 12} 项，请继续输入缩小范围</span>
            )}
          </div>
        )}
      </div>
      <select
        value=""
        onChange={(event) => {
          addItem(event.target.value);
        }}
      >
        <option value="">＋ 添加物品……</option>
        {candidates.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} · {RARITY_COLOR_NAMES[item.rarity]}（{item.id}）
          </option>
        ))}
      </select>
    </div>
  );
}

function FirstExtractionRewardEditor({
  value,
  catalog,
  onChange,
}: {
  value: unknown;
  catalog: Catalog;
  onChange: (next: Inventory) => void;
}) {
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const rewards: Inventory = isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(([itemId, quantity]) =>
          typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0
            ? [[itemId, quantity]]
            : [],
        ),
      )
    : {};
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const availableTags = Array.from(
    new Set(Object.values(catalog.items).flatMap((item) => item.tags ?? [])),
  ).sort((left, right) =>
    itemTagLabel(left).localeCompare(itemTagLabel(right), "zh-CN"),
  );
  const hasFilter = Boolean(normalizedQuery || tagFilter);
  const candidates = Object.values(catalog.items)
    .filter((item) => !Object.hasOwn(rewards, item.id))
    .filter((item) => !tagFilter || item.tags?.includes(tagFilter))
    .filter((item) =>
      normalizedQuery
        ? [
            item.name,
            item.id,
            RARITY_LABELS[item.rarity],
            RARITY_COLOR_NAMES[item.rarity],
            ...(item.tags ?? []).flatMap((tag) => [tag, itemTagLabel(tag)]),
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalizedQuery)
        : true,
    )
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
    .slice(0, 30);

  function removeReward(itemId: string): void {
    const next = { ...rewards };
    delete next[itemId];
    onChange(next);
  }

  return (
    <section className="config-first-clear-rewards">
      <div className="config-loot-section-title">
        <div>
          <span>本节点首次撤离奖励</span>
          <small>第一次从这个撤离点成功撤离时发放；每种物品固定为 1 个。</small>
        </div>
      </div>

      {!!Object.keys(rewards).length && (
        <div className="config-first-clear-list">
          {Object.keys(rewards).map((itemId) => {
            const item = catalog.items[itemId];
            return (
              <div key={itemId} className="config-first-clear-row">
                <div>
                  <strong>{item?.name ?? itemId}</strong>
                  <code>{itemId}</code>
                </div>
                <span className="config-first-clear-quantity">× 1</span>
                <button
                  type="button"
                  className="config-danger-button"
                  onClick={() => removeReward(itemId)}
                >
                  删除
                </button>
              </div>
            );
          })}
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
            aria-label="首次撤离奖励按物品 Tag 筛选"
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
            {candidates.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  onChange({ ...rewards, [item.id]: 1 });
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
            {!candidates.length && <span>没有可添加的匹配物品</span>}
          </div>
        )}
      </div>
    </section>
  );
}

function EventPoolPicker({
  selected,
  catalog,
  onChange,
}: {
  selected: string[];
  catalog: Catalog;
  onChange: (next: string[]) => void;
}) {
  const pools = Object.values(catalog.eventPools).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const enabled = selected.length > 0;

  return (
    <div className="config-field config-event-pools">
      <label className="config-check">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!pools.length}
          onChange={(event) =>
            onChange(event.target.checked && pools[0] ? [pools[0].id] : [])
          }
        />
        <span>抵达时抽取随机事件</span>
        <small>
          关闭后仍会结算战利品，然后直接进入路线选择；终点则直接进入撤离。
        </small>
      </label>
      {enabled && (
        <div className="config-event-pool-grid">
          {pools.map((pool) => {
            const checked = selected.includes(pool.id);
            const eventTitles = pool.eventIds
              .map((eventId) => catalog.events[eventId]?.title ?? eventId)
              .join("、");
            return (
              <label key={pool.id} className="config-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, pool.id]
                        : selected.filter((poolId) => poolId !== pool.id),
                    )
                  }
                />
                <span>{pool.id}</span>
                <small>
                  {pool.eventIds.length} 个事件
                  {eventTitles ? `：${eventTitles}` : ""}
                </small>
              </label>
            );
          })}
        </div>
      )}
      {!pools.length && <small>当前目录还没有可选择的事件池。</small>}
    </div>
  );
}

function RarityWeightEditor({
  values,
  onChange,
}: {
  values: Partial<Record<Rarity, number>>;
  onChange: (next: Partial<Record<Rarity, number>>) => void;
}) {
  const allWeights = RARITIES.map((rarity) => values[rarity] ?? 0);
  return (
    <div className="config-field">
      <span>每件物品的稀有度权重</span>
      <small>每件独立抽取；右侧为权重归一化后的实际概率。</small>
      <div className="config-loot-weight-grid">
        {RARITIES.map((rarity) => {
          const weight = values[rarity] ?? 0;
          return (
            <label key={rarity}>
              <b>{RARITY_COLOR_NAMES[rarity]} · {RARITY_LABELS[rarity]}</b>
              <input
                type="number"
                min="0"
                step="1"
                value={weight}
                onChange={(event) =>
                  onChange({
                    ...values,
                    [rarity]: Math.max(0, inputNumber(event.target.value)),
                  })
                }
              />
              <em>{positivePercent(weight, allWeights)}</em>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function CountWeightEditor({
  loot,
  onChange,
}: {
  loot: Extract<NodeLootDefinition, { mode: "independent" }>;
  onChange: (next: NodeLootDefinition) => void;
}) {
  const counts = integerRange(loot.minCount, loot.maxCount);
  const custom = loot.countWeights !== undefined;
  const weights = counts.map((count) => loot.countWeights?.[String(count)] ?? 0);

  return (
    <div className="config-field config-count-weights">
      <label className="config-check">
        <input
          type="checkbox"
          checked={custom}
          onChange={(event) => {
            if (!event.target.checked) {
              const next = { ...loot };
              delete next.countWeights;
              onChange(next);
              return;
            }
            onChange({
              ...loot,
              countWeights: Object.fromEntries(counts.map((count) => [count, 1])),
            });
          }}
        />
        <span>自定义掉落数量概率</span>
        <small>关闭时，范围内每个数量等概率。</small>
      </label>
      {custom && (
        <div className="config-count-weight-grid">
          {counts.map((count) => {
            const weight = loot.countWeights?.[String(count)] ?? 0;
            return (
              <label key={count}>
                <b>{count} 件</b>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={weight}
                  onChange={(event) =>
                    onChange({
                      ...loot,
                      countWeights: {
                        ...loot.countWeights,
                        [count]: Math.max(0, inputNumber(event.target.value)),
                      },
                    })
                  }
                />
                <em>{positivePercent(weight, weights)}</em>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CompositionEditor({
  loot,
  onChange,
}: {
  loot: Extract<NodeLootDefinition, { mode: "composition" }>;
  onChange: (next: NodeLootDefinition) => void;
}) {
  const weights = loot.compositions.map((composition) => composition.weight);

  function updateRow(index: number, nextRow: LootCompositionDefinition): void {
    const compositions = [...loot.compositions];
    compositions[index] = nextRow;
    onChange({ ...loot, compositions });
  }

  return (
    <div className="config-field config-compositions">
      <div className="config-loot-section-title">
        <div>
          <span>最终构成组合表</span>
          <small>先按组合权重命中一行，再严格按照该行数量抽取。</small>
        </div>
        <button
          type="button"
          onClick={() => {
            const used = new Set(loot.compositions.map((row) => row.id));
            let suffix = loot.compositions.length + 1;
            while (used.has(`composition-${suffix}`)) suffix += 1;
            onChange({
              ...loot,
              compositions: [
                ...loot.compositions,
                {
                  id: `composition-${suffix}`,
                  weight: 1,
                  rarityCounts: { common: Math.max(1, loot.minCount) },
                },
              ],
            });
          }}
        >
          ＋ 添加组合
        </button>
      </div>
      <div className="config-composition-scroll">
        <table className="config-composition-table">
          <thead>
            <tr>
              <th>组合 ID</th>
              <th>权重</th>
              <th>实际概率</th>
              {RARITIES.map((rarity) => (
                <th key={rarity}>{RARITY_COLOR_NAMES[rarity]}</th>
              ))}
              <th>总数</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loot.compositions.map((composition, index) => {
              const total = RARITIES.reduce(
                (sum, rarity) => sum + (composition.rarityCounts[rarity] ?? 0),
                0,
              );
              const invalidTotal = total < loot.minCount || total > loot.maxCount;
              return (
                <tr key={index}>
                  <td>
                    <input
                      value={composition.id}
                      onChange={(event) =>
                        updateRow(index, { ...composition, id: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={composition.weight}
                      onChange={(event) =>
                        updateRow(index, {
                          ...composition,
                          weight: Math.max(0, inputNumber(event.target.value)),
                        })
                      }
                    />
                  </td>
                  <td className="config-probability">
                    {positivePercent(composition.weight, weights)}
                  </td>
                  {RARITIES.map((rarity) => (
                    <td key={rarity}>
                      <input
                        aria-label={`${composition.id} ${RARITY_LABELS[rarity]}数量`}
                        type="number"
                        min="0"
                        step="1"
                        value={composition.rarityCounts[rarity] ?? 0}
                        onChange={(event) =>
                          updateRow(index, {
                            ...composition,
                            rarityCounts: {
                              ...composition.rarityCounts,
                              [rarity]: Math.max(
                                0,
                                Math.floor(inputNumber(event.target.value)),
                              ),
                            },
                          })
                        }
                      />
                    </td>
                  ))}
                  <td className={invalidTotal ? "config-total invalid" : "config-total"}>
                    {total}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="config-row-delete"
                      onClick={() =>
                        onChange({
                          ...loot,
                          compositions: loot.compositions.filter(
                            (_, rowIndex) => rowIndex !== index,
                          ),
                        })
                      }
                      title="删除组合"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!loot.compositions.length && (
        <p className="config-form-note">至少添加一个组合后才能应用配置。</p>
      )}
    </div>
  );
}

function RouteEditor({
  nodeId,
  edges,
  nodes,
  catalog,
  onChange,
}: {
  nodeId: string;
  edges: unknown;
  nodes: Record_;
  catalog: Catalog;
  onChange: (next: Record_[]) => void;
}) {
  const routes = Array.isArray(edges)
    ? edges.filter((edge): edge is Record_ => isRecord(edge))
    : [];
  const targets = Object.entries(nodes).filter(([targetId]) => targetId !== nodeId);

  function updateRoute(index: number, patch: Record_): void {
    onChange(
      routes.map((route, routeIndex) =>
        routeIndex === index ? { ...route, ...patch } : route,
      ),
    );
  }

  function addRoute(): void {
    const targetId = targets[0]?.[0];
    if (!targetId) return;
    const used = new Set(
      routes.flatMap((route) =>
        typeof route.id === "string" ? [route.id] : [],
      ),
    );
    let suffix = routes.length + 1;
    while (used.has(`route-${suffix}`)) suffix += 1;
    onChange([
      ...routes,
      {
        id: `route-${suffix}`,
        label: "新路线",
        description: "",
        toNodeId: targetId,
        durationMs: 10 * 60 * 1_000,
      },
    ]);
  }

  return (
    <div className="config-field config-route-editor">
      <div className="config-loot-section-title">
        <div>
          <span>下一步路线</span>
          <small>同一节点可以配置多条路线，玩家抵达后从中选择一条。</small>
        </div>
        <button type="button" disabled={!targets.length} onClick={addRoute}>
          ＋ 添加路线
        </button>
      </div>
      {!!routes.length && (
        <div className="config-route-list">
          {routes.map((route, index) => {
            const routeId =
              typeof route.id === "string" ? route.id : `route-${index + 1}`;
            const requirement = isRecord(route.requirement)
              ? route.requirement
              : {};
            const secondary = isRecord(requirement.secondary)
              ? requirement.secondary
              : undefined;
            const isHiddenRoute = route.hidden === true;
            const tagIds = Object.keys(catalog.tags);
            return (
              <div className="config-route-row" key={index}>
                <div className="config-route-row-head">
                  <label className="config-field">
                    <span>路线 ID</span>
                    <input
                      value={routeId}
                      onChange={(event) => updateRoute(index, { id: event.target.value })}
                    />
                  </label>
                  <label className="config-field">
                    <span>显示名称</span>
                    <input
                      value={typeof route.label === "string" ? route.label : ""}
                      onChange={(event) =>
                        updateRoute(index, { label: event.target.value })
                      }
                    />
                  </label>
                  <label className="config-field">
                    <span>目标节点</span>
                    <select
                      value={typeof route.toNodeId === "string" ? route.toNodeId : ""}
                      onChange={(event) =>
                        updateRoute(index, { toNodeId: event.target.value })
                      }
                    >
                      <option value="">选择目标节点</option>
                      {targets.map(([targetId, target]) => (
                        <option key={targetId} value={targetId}>
                          {isRecord(target) && typeof target.name === "string"
                            ? target.name
                            : targetId}
                          （{targetId}）
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="config-field config-route-duration">
                    <span>行进分钟</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={
                        typeof route.durationMs === "number"
                          ? route.durationMs / 60_000
                          : 0
                      }
                      onChange={(event) =>
                        updateRoute(index, {
                          durationMs: Math.max(
                            0,
                            Math.round(inputNumber(event.target.value) * 60_000),
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="config-row-delete"
                    title="删除路线"
                    onClick={() =>
                      onChange(routes.filter((_, routeIndex) => routeIndex !== index))
                    }
                  >
                    ×
                  </button>
                </div>
                <label className="config-field">
                  <span>路线说明</span>
                  <input
                    value={
                      typeof route.description === "string" ? route.description : ""
                    }
                    onChange={(event) =>
                      updateRoute(index, { description: event.target.value })
                    }
                  />
                </label>
                <div className="config-route-conditions">
                  <div className="config-route-condition">
                    <label className="config-check">
                      <input
                        type="checkbox"
                        checked={Boolean(secondary)}
                        onChange={(event) =>
                          updateRoute(index, {
                            requirement: {
                              ...requirement,
                              secondary: event.target.checked
                                ? { stat: "eloquence", value: 1 }
                                : undefined,
                            },
                          })
                        }
                      />
                      <span>次要属性门槛</span>
                      <small>路线始终可见，不满足时置灰并显示差值。</small>
                    </label>
                    {secondary && (
                      <div className="config-route-condition-fields">
                        <select
                          value={
                            typeof secondary.stat === "string"
                              ? secondary.stat
                              : "eloquence"
                          }
                          onChange={(event) =>
                            updateRoute(index, {
                              requirement: {
                                ...requirement,
                                secondary: {
                                  ...secondary,
                                  stat: event.target.value,
                                },
                              },
                            })
                          }
                        >
                          {SECONDARY_STAT_KEYS.map((stat) => (
                            <option key={stat} value={stat}>
                              {SECONDARY_STAT_LABELS[stat]}
                            </option>
                          ))}
                        </select>
                        <span>≥</span>
                        <input
                          aria-label="次要属性最低值"
                          type="number"
                          min="1"
                          step="1"
                          value={
                            typeof secondary.value === "number"
                              ? secondary.value
                              : 1
                          }
                          onChange={(event) =>
                            updateRoute(index, {
                              requirement: {
                                ...requirement,
                                secondary: {
                                  ...secondary,
                                  value: Math.max(
                                    1,
                                    Math.floor(inputNumber(event.target.value)),
                                  ),
                                },
                              },
                            })
                          }
                        />
                      </div>
                    )}
                  </div>

                  <div className="config-route-condition">
                    <label className="config-check">
                      <input
                        type="checkbox"
                        checked={isHiddenRoute}
                        onChange={(event) =>
                          updateRoute(index, {
                            requirement: {
                              ...requirement,
                              tagId: event.target.checked
                                ? tagIds[0] ?? ""
                                : undefined,
                            },
                            hidden: event.target.checked || undefined,
                          })
                        }
                      />
                      <span>隐藏路线（需要 Tag 触发）</span>
                      <small>感知不会揭示；实际走过后永久显示，但再次通行仍需 Tag。</small>
                    </label>
                    {isHiddenRoute && (
                      <div className="config-route-tag-fields">
                        <select
                          value={requirement.tagId as string}
                          onChange={(event) =>
                            updateRoute(index, {
                              requirement: {
                                ...requirement,
                                tagId: event.target.value,
                              },
                            })
                          }
                        >
                          {!tagIds.length && <option value="">没有可用 Tag</option>}
                          {Object.values(catalog.tags).map((tag) => (
                            <option key={tag.id} value={tag.id}>
                              {tag.name}（{tag.id}）
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!routes.length && (
        <p className="config-form-note">
          当前没有下一步路线。终点可以留空；非终点节点应至少添加一条路线。
        </p>
      )}
    </div>
  );
}

interface GraphPoint {
  id: string;
  x: number;
  y: number;
  reachable: boolean;
}

function MapGraphPreview({
  nodes,
  startNodeId,
}: {
  nodes: Record_;
  startNodeId: string;
}) {
  const nodeIds = Object.keys(nodes);
  const adjacency = new Map<string, string[]>();
  let danglingEdges = 0;
  let edgeCount = 0;

  for (const [nodeId, value] of Object.entries(nodes)) {
    const targets: string[] = [];
    if (isRecord(value) && Array.isArray(value.edges)) {
      for (const edge of value.edges) {
        if (!isRecord(edge) || typeof edge.toNodeId !== "string") continue;
        edgeCount += 1;
        if (Object.hasOwn(nodes, edge.toNodeId)) targets.push(edge.toNodeId);
        else danglingEdges += 1;
      }
    }
    adjacency.set(nodeId, targets);
  }

  // 以入口为根做最短层级布局。非法循环也只访问一次，不会卡住配置台。
  const depths = new Map<string, number>();
  if (Object.hasOwn(nodes, startNodeId)) {
    depths.set(startNodeId, 0);
    const queue = [startNodeId];
    while (queue.length) {
      const current = queue.shift()!;
      const nextDepth = (depths.get(current) ?? 0) + 1;
      for (const target of adjacency.get(current) ?? []) {
        if (depths.has(target)) continue;
        depths.set(target, nextDepth);
        queue.push(target);
      }
    }
  }

  const reachableMax = Math.max(0, ...depths.values());
  const unreachableIds = nodeIds.filter((nodeId) => !depths.has(nodeId));
  const layers = new Map<number, string[]>();
  for (const nodeId of nodeIds) {
    const layer = depths.get(nodeId) ?? reachableMax + 1;
    layers.set(layer, [...(layers.get(layer) ?? []), nodeId]);
  }
  const layerNumbers = [...layers.keys()].sort((left, right) => left - right);
  const maxPerLayer = Math.max(1, ...[...layers.values()].map((ids) => ids.length));
  const width = Math.max(560, (Math.max(0, ...layerNumbers) + 1) * 205 + 80);
  const height = Math.max(190, maxPerLayer * 88 + 70);
  const positions = new Map<string, GraphPoint>();

  for (const layer of layerNumbers) {
    const ids = layers.get(layer) ?? [];
    const available = height - 70;
    ids.forEach((nodeId, index) => {
      positions.set(nodeId, {
        id: nodeId,
        x: 55 + layer * 205,
        y: 35 + ((index + 1) * available) / (ids.length + 1),
        reachable: depths.has(nodeId),
      });
    });
  }

  const graphEdges = Object.entries(nodes).flatMap(([sourceId, value]) => {
    if (!isRecord(value) || !Array.isArray(value.edges)) return [];
    return value.edges.flatMap((edge, index) =>
      isRecord(edge) &&
      typeof edge.toNodeId === "string" &&
      positions.has(edge.toNodeId)
        ? [{ sourceId, edge, index }]
        : [],
    );
  });

  if (!nodeIds.length) return null;

  return (
    <section className="config-map-graph">
      <div className="config-map-graph-head">
        <div>
          <strong>地图拓扑预览</strong>
          <span>{nodeIds.length} 个节点 · {edgeCount} 条单向路径</span>
        </div>
        <div className="config-graph-legend">
          <span className="entry">入口</span>
          <span className="normal">探索节点</span>
          <span className="extractable">撤离点</span>
          <span className="terminal">终点</span>
          <span className="hidden">隐藏路径</span>
          <span className="unreachable">不可达</span>
        </div>
      </div>
      <div className="config-map-graph-scroll">
        <svg
          role="img"
          aria-label="地图节点单向连通图"
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth: width }}
        >
          <defs>
            <marker
              id="config-map-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" />
            </marker>
          </defs>
          {graphEdges.map(({ sourceId, edge, index }) => {
            const source = positions.get(sourceId)!;
            const target = positions.get(edge.toNodeId as string)!;
            const x1 = source.x + 66;
            const y1 = source.y + (index % 3 - 1) * 5;
            const x2 = target.x - 66;
            const y2 = target.y;
            const forward = x2 > x1;
            const controlOffset = forward ? Math.max(45, (x2 - x1) / 2) : 55;
            const path = forward
              ? `M ${x1} ${y1} C ${x1 + controlOffset} ${y1}, ${x2 - controlOffset} ${y2}, ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1 + controlOffset} ${y1 - 42}, ${x2 - controlOffset} ${y2 - 42}, ${x2} ${y2}`;
            const label = typeof edge.label === "string" ? edge.label : "未命名路线";
            return (
              <g
                className={`config-graph-edge ${edge.hidden === true ? "hidden" : ""}`}
                key={`${sourceId}-${index}`}
              >
                <path d={path} markerEnd="url(#config-map-arrow)" />
                <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 7}>
                  {label.length > 10 ? `${label.slice(0, 10)}…` : label}
                </text>
                <title>{label}</title>
              </g>
            );
          })}
          {[...positions.values()].map((point) => {
            const rawNode = nodes[point.id];
            const node = isRecord(rawNode) ? rawNode : {};
            const name = typeof node.name === "string" ? node.name : point.id;
            const kind =
              point.id === startNodeId
                ? "entry"
                : !point.reachable
                  ? "unreachable"
                  : node.terminal === true
                    ? "terminal"
                    : node.extractable === true
                      ? "extractable"
                    : "normal";
            return (
              <g
                className={`config-graph-node ${kind}`}
                key={point.id}
                transform={`translate(${point.x - 66} ${point.y - 25})`}
              >
                <rect width="132" height="50" rx="9" />
                <text className="name" x="66" y="21">
                  {name.length > 10 ? `${name.slice(0, 10)}…` : name}
                </text>
                <text className="id" x="66" y="37">
                  {point.id.length > 18 ? `${point.id.slice(0, 18)}…` : point.id}
                </text>
                <title>{name}（{point.id}）</title>
              </g>
            );
          })}
        </svg>
      </div>
      {(unreachableIds.length > 0 || danglingEdges > 0) && (
        <p className="config-graph-warning">
          {unreachableIds.length > 0 &&
            `入口无法到达：${unreachableIds.join("、")}。`}
          {danglingEdges > 0 && `另有 ${danglingEdges} 条路径指向不存在的节点。`}
        </p>
      )}
    </section>
  );
}

function NodeLootEditor({
  nodeId,
  node,
  catalog,
  nodes,
  isStart,
  onChange,
  onNodeChange,
  onDelete,
}: {
  nodeId: string;
  node: Record_;
  catalog: Catalog;
  nodes: Record_;
  isStart: boolean;
  onChange: (next: NodeLootDefinition) => void;
  onNodeChange: (patch: Record_) => void;
  onDelete: () => void;
}) {
  const loot = safeLoot(node.loot);
  const minCount = intValue(loot.minCount, 1);
  const maxCount = intValue(loot.maxCount, minCount);

  function setRange(key: "minCount" | "maxCount", value: number): void {
    const next = { ...loot, [key]: Math.max(1, Math.floor(value)) };
    if (next.mode === "independent" && next.countWeights) {
      const counts = integerRange(next.minCount, next.maxCount);
      next.countWeights = Object.fromEntries(
        counts.map((count) => [count, next.countWeights?.[String(count)] ?? 1]),
      );
    }
    onChange(next);
  }

  const whitelist = loot.whitelistItemIds ?? [];
  const whitelistTags = loot.whitelistItemTags ?? [];
  const blacklist = loot.blacklistItemIds ?? [];
  const blacklistTags = loot.blacklistItemTags ?? [];
  const eventPoolIds = Array.isArray(node.eventPoolIds)
    ? node.eventPoolIds.filter(
        (poolId): poolId is string => typeof poolId === "string",
      )
    : [];
  const nodeName = typeof node.name === "string" ? node.name : nodeId;

  return (
    <details className="config-node-loot" open>
      <summary>
        <span>
          <strong>{nodeName}</strong>
          <code>{nodeId}</code>
        </span>
        <div className="config-node-actions">
          <em>
            {isStart
              ? "起始入口"
              : loot.mode === "independent"
                ? "独立抽取"
                : "组合表"}
          </em>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDelete();
            }}
          >
            删除节点
          </button>
        </div>
      </summary>
      <div className="config-node-loot-body">
        <div className="config-field-row">
          <label className="config-field">
            <span>节点名称</span>
            <input
              value={nodeName}
              onChange={(event) => onNodeChange({ name: event.target.value })}
            />
          </label>
          {isStart ? (
            <div className="config-start-role">
              <strong>地图入口</strong>
              <small>只负责选择首个探索目标，不能同时作为固定终点。</small>
            </div>
          ) : (
            <div className="config-node-roles">
              <label className="config-check config-node-terminal">
                <input
                  type="checkbox"
                  checked={node.terminal === true}
                  onChange={(event) =>
                    onNodeChange({
                      terminal: event.target.checked,
                      ...(event.target.checked ? { extractable: undefined } : {}),
                    })
                  }
                />
                <span>固定终点</span>
                <small>天然可撤离；处理事件后强制进入撤离整理。</small>
              </label>
              {node.terminal !== true && (
                <label className="config-check config-node-terminal">
                  <input
                    type="checkbox"
                    checked={node.extractable === true}
                    onChange={(event) =>
                      onNodeChange({ extractable: event.target.checked || undefined })
                    }
                  />
                  <span>中途撤离点</span>
                  <small>开启后玩家可以在这里见好就收；普通节点不能撤离。</small>
                </label>
              )}
            </div>
          )}
        </div>

        {isStart ? (
          <div className="config-start-node-note">
            <strong>起始节点不进行探索结算</strong>
            <p>队伍抵达后直接选择下一条路线，不会获得战利品，也不会抽取随机事件。</p>
          </div>
        ) : (
          <>
        <div className="config-loot-mode-switch" role="group" aria-label="掉落模式">
          <button
            type="button"
            className={loot.mode === "independent" ? "active" : ""}
            onClick={() => {
              if (loot.mode === "independent") return;
              onChange({
                mode: "independent",
                minCount,
                maxCount,
                rarityWeights: { common: 50, uncommon: 30, rare: 15, epic: 5 },
                whitelistItemIds: whitelist,
                whitelistItemTags: whitelistTags,
                blacklistItemIds: blacklist,
                blacklistItemTags: blacklistTags,
              });
            }}
          >
            <strong>独立抽取</strong>
            <small>每件分别抽稀有度</small>
          </button>
          <button
            type="button"
            className={loot.mode === "composition" ? "active" : ""}
            onClick={() => {
              if (loot.mode === "composition") return;
              onChange({
                mode: "composition",
                minCount,
                maxCount,
                compositions: [
                  {
                    id: "composition-1",
                    weight: 1,
                    rarityCounts: { common: Math.max(1, minCount) },
                  },
                ],
                whitelistItemIds: whitelist,
                whitelistItemTags: whitelistTags,
                blacklistItemIds: blacklist,
                blacklistItemTags: blacklistTags,
              });
            }}
          >
            <strong>组合表</strong>
            <small>控制最终稀有度构成</small>
          </button>
        </div>

        <div className="config-field-row">
          <label className="config-field">
            <span>最少掉落</span>
            <input
              type="number"
              min="1"
              step="1"
              value={minCount}
              onChange={(event) => setRange("minCount", inputNumber(event.target.value))}
            />
          </label>
          <label className="config-field">
            <span>最多掉落</span>
            <input
              type="number"
              min="1"
              step="1"
              value={maxCount}
              onChange={(event) => setRange("maxCount", inputNumber(event.target.value))}
            />
          </label>
        </div>

        {loot.mode === "independent" ? (
          <>
            <CountWeightEditor loot={loot} onChange={onChange} />
            <RarityWeightEditor
              values={loot.rarityWeights}
              onChange={(rarityWeights) => onChange({ ...loot, rarityWeights })}
            />
          </>
        ) : (
          <CompositionEditor loot={loot} onChange={onChange} />
        )}

        <div className="config-loot-filter-row">
          <ItemListPicker
            label="白名单"
            description="物品与物品 Tag 取并集；两者都留空表示不限制。"
            selected={whitelist}
            selectedTags={whitelistTags}
            catalog={catalog}
            onChange={(whitelistItemIds) => onChange({ ...loot, whitelistItemIds })}
            onTagsChange={(whitelistItemTags) =>
              onChange({ ...loot, whitelistItemTags })
            }
          />
          <ItemListPicker
            label="黑名单"
            description="物品与物品 Tag 取并集，在白名单过滤后统一排除。"
            selected={blacklist}
            selectedTags={blacklistTags}
            catalog={catalog}
            onChange={(blacklistItemIds) => onChange({ ...loot, blacklistItemIds })}
            onTagsChange={(blacklistItemTags) =>
              onChange({ ...loot, blacklistItemTags })
            }
          />
        </div>

        <EventPoolPicker
          selected={eventPoolIds}
          catalog={catalog}
          onChange={(nextEventPoolIds) =>
            onNodeChange({ eventPoolIds: nextEventPoolIds })
          }
        />

        {node.terminal === true || node.extractable === true ? (
          <FirstExtractionRewardEditor
            value={node.firstExtractionRewards}
            catalog={catalog}
            onChange={(firstExtractionRewards) =>
              onNodeChange({
                firstExtractionRewards: Object.keys(firstExtractionRewards).length
                  ? firstExtractionRewards
                  : undefined,
              })
            }
          />
        ) : (
          <p className="config-form-note">
            当前节点不可撤离，因此不能配置首次撤离奖励。
          </p>
        )}
          </>
        )}

        <RouteEditor
          nodeId={nodeId}
          edges={node.edges}
          nodes={nodes}
          catalog={catalog}
          onChange={(edges) => onNodeChange({ edges })}
        />
      </div>
    </details>
  );
}

export function MapForm({
  record,
  catalog,
  onChange,
}: {
  record: Record_;
  catalog: Catalog;
  onChange: (next: Record_) => void;
}) {
  const nodes = isRecord(record.nodes) ? record.nodes : {};
  const [newNodeId, setNewNodeId] = useState("");
  const [structureError, setStructureError] = useState("");

  function updateMap(patch: Record_): void {
    onChange({ ...record, ...patch });
    setStructureError("");
  }

  function updateNode(nodeId: string, patch: Record_): void {
    const next = structuredClone(record);
    const nextNodes = isRecord(next.nodes) ? next.nodes : {};
    const nextNode = isRecord(nextNodes[nodeId]) ? nextNodes[nodeId] : {};
    nextNodes[nodeId] = { ...nextNode, ...patch };
    next.nodes = nextNodes;
    onChange(next);
    setStructureError("");
  }

  function updateNodeLoot(nodeId: string, loot: NodeLootDefinition): void {
    updateNode(nodeId, { loot });
  }

  function addNode(): void {
    const id = newNodeId.trim();
    if (!/^[a-z0-9][a-z0-9-_]*$/i.test(id)) {
      setStructureError("节点 ID 只能包含字母、数字、短横线和下划线。");
      return;
    }
    if (nodes[id]) {
      setStructureError(`节点 ID ${id} 已存在。`);
      return;
    }
    const defaultPoolId = Object.keys(catalog.eventPools)[0];
    const nextNodes = structuredClone(nodes);
    nextNodes[id] = {
      id,
      name: "新节点",
      loot: {
        mode: "independent",
        minCount: 3,
        maxCount: 5,
        rarityWeights: { common: 50, uncommon: 30, rare: 15, epic: 5 },
      },
      eventPoolIds: defaultPoolId ? [defaultPoolId] : [],
      edges: [],
      terminal: true,
    };
    updateMap({
      nodes: nextNodes,
      ...(!record.startNodeId ? { startNodeId: id } : {}),
    });
    setNewNodeId("");
  }

  function deleteNode(nodeId: string): void {
    const nodeIds = Object.keys(nodes);
    if (nodeIds.length <= 1) {
      setStructureError("地图至少需要保留一个节点，不能删除最后一个节点。");
      return;
    }
    const incomingCount = Object.values(nodes).reduce<number>((total, value) => {
      if (!isRecord(value) || !Array.isArray(value.edges)) return total;
      return (
        total +
        value.edges.filter(
          (edge) => isRecord(edge) && edge.toNodeId === nodeId,
        ).length
      );
    }, 0);
    const selectedNode = nodes[nodeId];
    const nodeName =
      isRecord(selectedNode) && typeof selectedNode.name === "string"
        ? selectedNode.name
        : nodeId;
    const consequence = incomingCount
      ? `并同步删除 ${incomingCount} 条指向它的路线。`
      : "";
    if (!window.confirm(`确认删除节点“${nodeName}”（${nodeId}）？${consequence}`)) {
      return;
    }

    const nextNodes = structuredClone(nodes);
    delete nextNodes[nodeId];
    for (const value of Object.values(nextNodes)) {
      if (!isRecord(value) || !Array.isArray(value.edges)) continue;
      value.edges = value.edges.filter(
        (edge) => !isRecord(edge) || edge.toNodeId !== nodeId,
      );
    }
    const remainingIds = Object.keys(nextNodes);
    updateMap({
      nodes: nextNodes,
      ...(record.startNodeId === nodeId
        ? { startNodeId: remainingIds[0] }
        : {}),
    });
  }

  return (
    <div className="config-form config-map-form">
      <div className="config-map-form-intro">
        <div>
          <strong>地图与节点</strong>
          <span>{Object.keys(nodes).length} 个节点</span>
        </div>
        <p>
          可在这里维护地图情报阈值、节点、路线、事件池与掉落。
        </p>
      </div>

      <div className="config-map-basics">
        <label className="config-field">
          <span>地图名称</span>
          <input
            value={typeof record.name === "string" ? record.name : ""}
            onChange={(event) => updateMap({ name: event.target.value })}
          />
        </label>
        <label className="config-field">
          <span>地图编号</span>
          <input
            type="number"
            min="1"
            step="1"
            value={intValue(record.number, 1)}
            onChange={(event) =>
              updateMap({ number: Math.max(1, Math.floor(inputNumber(event.target.value))) })
            }
          />
        </label>
        <label className="config-field">
          <span>起始节点</span>
          <select
            value={typeof record.startNodeId === "string" ? record.startNodeId : ""}
            onChange={(event) => updateMap({ startNodeId: event.target.value })}
          >
            {Object.entries(nodes).map(([nodeId, value]) => (
              <option key={nodeId} value={nodeId}>
                {isRecord(value) && typeof value.name === "string" ? value.name : nodeId}（{nodeId}）
              </option>
            ))}
          </select>
        </label>
        <label className="config-field">
          <span>部分情报感知</span>
          <input
            type="number"
            min="0"
            step="1"
            value={
              isRecord(record.informationThresholds)
                ? intValue(record.informationThresholds.partial, 2)
                : 2
            }
            onChange={(event) =>
              updateMap({
                informationThresholds: {
                  ...(isRecord(record.informationThresholds)
                    ? record.informationThresholds
                    : { full: 4 }),
                  partial: Math.max(0, Math.floor(inputNumber(event.target.value))),
                },
              })
            }
          />
        </label>
        <label className="config-field">
          <span>完整情报感知</span>
          <input
            type="number"
            min="1"
            step="1"
            value={
              isRecord(record.informationThresholds)
                ? intValue(record.informationThresholds.full, 4)
                : 4
            }
            onChange={(event) =>
              updateMap({
                informationThresholds: {
                  ...(isRecord(record.informationThresholds)
                    ? record.informationThresholds
                    : { partial: 2 }),
                  full: Math.max(1, Math.floor(inputNumber(event.target.value))),
                },
              })
            }
          />
        </label>
      </div>
      <label className="config-field">
        <span>地图说明</span>
        <textarea
          rows={2}
          value={typeof record.description === "string" ? record.description : ""}
          onChange={(event) => updateMap({ description: event.target.value })}
        />
      </label>

      <MapGraphPreview
        nodes={nodes}
        startNodeId={
          typeof record.startNodeId === "string" ? record.startNodeId : ""
        }
      />

      <div className="config-node-create">
        <div>
          <strong>节点列表</strong>
          <small>节点 ID 创建后保持不变；显示名称可以随时修改。</small>
        </div>
        <div>
          <input
            value={newNodeId}
            onChange={(event) => {
              setNewNodeId(event.target.value);
              setStructureError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") addNode();
            }}
            placeholder="输入新节点 ID"
          />
          <button type="button" onClick={addNode}>＋ 新增节点</button>
        </div>
      </div>
      {structureError && <p className="config-editor-error">{structureError}</p>}
      {Object.entries(nodes).map(([nodeId, value]) =>
        isRecord(value) ? (
          <NodeLootEditor
            key={nodeId}
            nodeId={nodeId}
            node={value}
            catalog={catalog}
            nodes={nodes}
            isStart={record.startNodeId === nodeId}
            onChange={(loot) => updateNodeLoot(nodeId, loot)}
            onNodeChange={(patch) => updateNode(nodeId, patch)}
            onDelete={() => deleteNode(nodeId)}
          />
        ) : null,
      )}
      {!Object.keys(nodes).length && (
        <p className="config-form-note">当前地图没有可编辑的节点。</p>
      )}
    </div>
  );
}
