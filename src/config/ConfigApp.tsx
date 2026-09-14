import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  SECONDARY_STAT_KEYS,
  SECONDARY_STAT_LABELS,
} from "../domain/engine";
import { itemTagLabel } from "../domain/itemTags";
import { RARITIES, RARITY_LABELS } from "../domain/rarity";
import type { Rarity } from "../domain/rarity";
import type { Catalog, SecondaryStatKey } from "../domain/types";
import { clearGame } from "../persistence/storage";
import {
  acknowledgeBundledUpdate,
  clearLocalCatalogOverrides,
  clearPublishedCatalog,
  diffAgainstBundled,
  fingerprintCatalog,
  loadCatalogDraft,
  publishCatalog,
  resetCatalogDraft,
  saveCatalogDraft,
  validateCatalog,
  type CatalogDiffEntry,
  type CatalogCategory,
  type CatalogIssue,
  type CatalogSource,
} from "./catalogStore";
import { bundledCatalog } from "../domain/catalog";
import { ItemForm } from "./ItemForm";
import { MapForm } from "./MapForm";
import { PetForm } from "./PetForm";
import { TaskForm } from "./TaskForm";
import { EventForm } from "./EventForm";
import { EventPoolForm } from "./EventPoolForm";
import { lootIconUrl } from "../ui/lootIcons";
import "./configStyles.css";

type EditorMode = "form" | "json";
type ItemTagFilter = "all" | "untagged" | string;

interface PublishPreview {
  ok: boolean;
  issues: CatalogIssue[];
  changes: CatalogDiffEntry[];
  currentFingerprint: string;
  candidateFingerprint: string;
  target: string;
  error?: string;
}

async function postCatalogPublishRequest(
  path: string,
  body: unknown,
): Promise<PublishPreview> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let result: PublishPreview;
  try {
    result = (await response.json()) as PublishPreview;
  } catch {
    throw new Error("发布接口不可用；请确认配置台由 npm run dev 启动。");
  }
  if (!response.ok && !result.issues) {
    throw new Error(result.error ?? `发布接口返回 ${response.status}`);
  }
  return result;
}

// 高频且结构复杂的内容提供表单；所有表单都和 JSON 共用 editorText，
// 最终继续由 validateCatalog 统一校验。
const FORM_CATEGORIES: CatalogCategory[] = [
  "maps",
  "events",
  "eventPools",
  "items",
  "petTemplates",
  "tasks",
];

const SOURCE_LABELS: Record<CatalogSource, string> = {
  draft: "本地草稿",
  published: "已应用配置",
  bundled: "代码内置",
};

const CATEGORY_META: Record<
  CatalogCategory,
  { label: string; singular: string; description: string }
> = {
  maps: { label: "地图", singular: "地图", description: "节点、路线与终点" },
  events: { label: "事件", singular: "事件", description: "事件选项与奖励" },
  eventPools: {
    label: "事件池",
    singular: "事件池",
    description: "事件抽取集合",
  },
  items: { label: "物品", singular: "物品", description: "重量、售价与用途" },
  tasks: { label: "任务", singular: "任务", description: "条件与账号奖励" },
  petTemplates: {
    label: "宠物",
    singular: "宠物",
    description: "初始属性与 Tag 槽",
  },
  tags: { label: "Tag", singular: "Tag", description: "永久正向特质" },
};

const CATEGORY_ORDER: CatalogCategory[] = [
  "maps",
  "events",
  "eventPools",
  "items",
  "tasks",
  "petTemplates",
  "tags",
];

function recordsOf(
  catalog: Catalog,
  category: CatalogCategory,
): Record<string, Record<string, unknown>> {
  return catalog[category] as unknown as Record<string, Record<string, unknown>>;
}

function displayName(record: Record<string, unknown>, id: string): string {
  const value = record.name ?? record.title;
  return typeof value === "string" && value.trim() ? value : id;
}

function isRecordValue(
  value: unknown,
): value is Record<string, string | number | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// 物品分类标签，非法值在配置校验里已经会提醒，这里只负责显示。
function itemTagsOf(record: Record<string, unknown>): string[] {
  return Array.isArray(record.tags)
    ? record.tags.filter(
        (tag): tag is string => typeof tag === "string" && Boolean(tag.trim()),
      )
    : [];
}

function recordDetail(
  category: CatalogCategory,
  record: Record<string, unknown>,
): string {
  if (category === "maps") {
    return `${Object.keys((record.nodes as object | undefined) ?? {}).length} 个节点`;
  }
  if (category === "events") {
    return `${Array.isArray(record.choices) ? record.choices.length : 0} 个选项`;
  }
  if (category === "eventPools") {
    return `${Array.isArray(record.eventIds) ? record.eventIds.length : 0} 个事件`;
  }
  if (category === "items") {
    const rarity = record.rarity;
    const label =
      typeof rarity === "string" && rarity in RARITY_LABELS
        ? RARITY_LABELS[rarity as Rarity]
        : "?";
    // 省略 stackSize 就是一件一格，列表里直接显示实际生效值。
    const stack =
      typeof record.stackSize === "number" && record.stackSize > 0
        ? record.stackSize
        : 1;
    const price = record.sellable
      ? `单价 ${String(record.sellValue ?? 0)}`
      : "不可出售";
    const secondaryGrant = record.secondaryGrant;
    const growth = isRecordValue(secondaryGrant)
      ? ` · 使用后${SECONDARY_STAT_LABELS[secondaryGrant.stat as SecondaryStatKey] ?? String(secondaryGrant.stat)} +${String(secondaryGrant.amount ?? "?")}`
      : typeof record.tagGrantId === "string"
        ? ` · 使用后赋予 Tag ${record.tagGrantId}`
        : "";
    return `${label} · 重量 ${String(record.weight ?? "-")} · 每格 ${stack} · ${price}${growth}`;
  }
  if (category === "petTemplates") {
    const base = record.baseStats;
    const main = isRecordValue(base)
      ? `体 ${base.fitness ?? "-"} · 感 ${base.perception ?? "-"} · 技 ${base.technique ?? "-"}`
      : "主属性缺失";
    const secondary = record.secondaryStats;
    const sub = isRecordValue(secondary)
      ? SECONDARY_STAT_KEYS.map(
          (key) => `${SECONDARY_STAT_LABELS[key]} ${secondary[key] ?? "-"}`,
        ).join(" · ")
      : "次要属性缺失";
    return `${main}　|　${sub}`;
  }
  return typeof record.description === "string" ? record.description : "";
}

function createTemplate(
  category: CatalogCategory,
  id: string,
): Record<string, unknown> {
  switch (category) {
    case "items":
      // 描述只在传说及以上档位需要，新物品默认常见，因此模板不带描述字段。
      return { id, name: "新物品", rarity: "common", weight: 1, sellValue: 1 };
    case "tags":
      // Tag 不带任何主属性加成，新建时只有身份信息。
      return { id, name: "新 Tag", description: "" };
    case "events":
      return {
        id,
        title: "新事件",
        description: "",
        choices: [
          {
            id: "choice-1",
            label: "处理",
            description: "",
            resolution: {
              type: "primary",
              stat: "perception",
              difficulty: 3,
            },
            rewards: {},
          },
        ],
      };
    case "eventPools":
      return { id, eventIds: [] };
    case "maps":
      return {
        id,
        number: 1,
        name: "新地图",
        description: "",
        startNodeId: "start",
        startDurationMs: 600000,
        informationThresholds: { partial: 2, full: 4 },
        nodes: {
          start: {
            id: "start",
            name: "地图入口",
            edges: [],
          },
        },
      };
    case "tasks":
      return {
        id,
        title: "新任务",
        description: "",
        requirement: { currency: 1 },
        reward: { currency: 1 },
      };
    case "petTemplates":
      return {
        id,
        name: "新宠物",
        level: 1,
        xp: 0,
        unspentPoints: 0,
        baseStats: { fitness: 2, perception: 2, technique: 2 },
        allocatedStats: { fitness: 0, perception: 0, technique: 0 },
        // 四项次要属性人人都有，新模板先给 0，由策划逐只拉开差距。
        secondaryStats: { eloquence: 0, lore: 0, courage: 0, guile: 0 },
        injury: "healthy",
        growthTagIds: [],
        growthTagSlots: 1,
      };
  }
}

function downloadCatalog(catalog: Catalog): void {
  const blob = new Blob([JSON.stringify(catalog, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `idle-catalog-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ConfigApp() {
  const [loaded] = useState(loadCatalogDraft);
  const [draft, setDraft] = useState<Catalog>(loaded.catalog);
  const [source, setSource] = useState<CatalogSource>(loaded.source);
  const [bundledChanged, setBundledChanged] = useState(loaded.bundledChanged);
  const [category, setCategory] = useState<CatalogCategory>("maps");
  const [selectedId, setSelectedId] = useState("");
  const [editorText, setEditorText] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("本地草稿已载入");
  const [editorError, setEditorError] = useState("");
  const [mode, setMode] = useState<EditorMode>("form");
  const [rarityFilter, setRarityFilter] = useState<Rarity | "all">("all");
  const [itemTagFilter, setItemTagFilter] = useState<ItemTagFilter>("all");
  const [publishPreview, setPublishPreview] = useState<PublishPreview | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  const records = recordsOf(draft, category);
  // 只有物品带稀有度，其余分类不显示这一排筛选。
  const supportsRarity = category === "items";

  const searchMatches = useMemo(
    () =>
      Object.entries(records)
        .filter(([id, record]) => {
          const query = search.trim().toLowerCase();
          if (!query) return true;
          return `${id} ${displayName(record, id)}`
            .toLowerCase()
            .includes(query);
        })
        .sort(([a], [b]) => a.localeCompare(b)),
    [records, search],
  );

  // 计数跟着搜索走，否则筛选条上的数字会和点进去看到的条数对不上。
  const rarityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [, record] of searchMatches) {
      const rarity = record.rarity;
      if (typeof rarity !== "string") continue;
      counts.set(rarity, (counts.get(rarity) ?? 0) + 1);
    }
    return counts;
  }, [searchMatches]);

  const rarityMatches = useMemo(
    () =>
      supportsRarity && rarityFilter !== "all"
        ? searchMatches.filter(([, record]) => record.rarity === rarityFilter)
        : searchMatches,
    [searchMatches, supportsRarity, rarityFilter],
  );

  // Tag 选项取当前草稿里的真实值，因此自定义 Tag 也能立即用于筛选。
  const availableItemTags = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(records).flatMap((record) => itemTagsOf(record)),
        ),
      ).sort((left, right) =>
        itemTagLabel(left).localeCompare(itemTagLabel(right), "zh-CN"),
      ),
    [records],
  );

  // 数量跟随搜索和稀有度筛选，方便判断继续叠加 Tag 后会剩多少条。
  const itemTagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let untagged = 0;
    for (const [, record] of rarityMatches) {
      const tags = itemTagsOf(record);
      if (!tags.length) untagged += 1;
      for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return { counts, untagged };
  }, [rarityMatches]);

  const recordEntries = useMemo(() => {
    if (!supportsRarity || itemTagFilter === "all") return rarityMatches;
    return rarityMatches.filter(([, record]) => {
      const tags = itemTagsOf(record);
      return itemTagFilter === "untagged"
        ? tags.length === 0
        : tags.includes(itemTagFilter);
    });
  }, [itemTagFilter, rarityMatches, supportsRarity]);
  // 直接比指纹，回答"我现在看到的到底是不是代码里那份"。
  const divergedFromBundled = useMemo(
    () => fingerprintCatalog(draft) !== fingerprintCatalog(bundledCatalog),
    [draft],
  );
  const bundledDiff = useMemo(
    () => (bundledChanged ? diffAgainstBundled(draft) : []),
    [bundledChanged, draft],
  );

  const issues = useMemo(() => validateCatalog(draft), [draft]);
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");

  // 表单是 editorText 的结构化视图，两种模式共用同一份未保存文本，
  // 因此来回切换不会丢改动，保存路径也只有一条。
  const parsedRecord = useMemo(() => {
    try {
      const value: unknown = JSON.parse(editorText);
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }, [editorText]);

  // 筛选不会改变选中项（否则会丢掉未保存的编辑），但要说明它为什么不在左侧列表里。
  const selectedRecord = selectedId ? records[selectedId] : undefined;
  const selectedRecordTags = selectedRecord ? itemTagsOf(selectedRecord) : [];
  const hiddenByRarity = Boolean(
    supportsRarity &&
      rarityFilter !== "all" &&
      selectedRecord &&
      selectedRecord.rarity !== rarityFilter,
  );
  const hiddenByItemTag = Boolean(
    supportsRarity &&
      itemTagFilter !== "all" &&
      selectedRecord &&
      (itemTagFilter === "untagged"
        ? selectedRecordTags.length > 0
        : !selectedRecordTags.includes(itemTagFilter)),
  );
  const hiddenByFilter = hiddenByRarity || hiddenByItemTag;

  const supportsForm = FORM_CATEGORIES.includes(category);
  const effectiveMode: EditorMode = supportsForm ? mode : "json";
  const dirty = Boolean(
    selectedId &&
      records[selectedId] &&
      editorText !== JSON.stringify(records[selectedId], null, 2),
  );

  useEffect(() => {
    const ids = Object.keys(records);
    if (!selectedId || !records[selectedId]) {
      setSelectedId(ids[0] ?? "");
    }
  }, [records, selectedId]);

  useEffect(() => {
    const record = records[selectedId];
    setEditorText(record ? JSON.stringify(record, null, 2) : "");
    setEditorError("");
  }, [records, selectedId]);

  function replaceDraft(next: Catalog, message: string): void {
    setDraft(next);
    saveCatalogDraft(next);
    setSource("draft");
    setStatus(message);
  }

  function changeCategory(next: CatalogCategory): void {
    setCategory(next);
    setSelectedId("");
    setSearch("");
    setRarityFilter("all");
    setItemTagFilter("all");
  }

  // 表单里的局部保存（例如地图节点浮层）直接把记录传进来：同一次事件里
  // editorText 还是旧值，只能读参数，不能回头去 parse 那个字符串。
  function saveRecord(explicit?: Record<string, unknown>): void {
    if (!selectedId) return;
    try {
      const parsed =
        explicit ?? (JSON.parse(editorText) as Record<string, unknown>);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("记录必须是 JSON 对象。");
      }
      if (parsed.id !== selectedId) {
        throw new Error(`记录 id 必须保持为 “${selectedId}”。`);
      }
      const next = structuredClone(draft);
      recordsOf(next, category)[selectedId] = parsed;
      setEditorText(JSON.stringify(parsed, null, 2));
      replaceDraft(next, `已保存 ${selectedId}`);
      setEditorError("");
    } catch (error) {
      setEditorError(
        error instanceof Error ? error.message : "JSON 格式不正确。",
      );
    }
  }

  function addRecord(source?: Record<string, unknown>): void {
    const suggested = `${category.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)}-new`;
    const id = window.prompt(`输入新${CATEGORY_META[category].singular} ID`, suggested);
    if (!id) return;
    if (!/^[a-z0-9][a-z0-9-_]*$/i.test(id)) {
      setStatus("ID 只能包含字母、数字、短横线和下划线");
      return;
    }
    if (records[id]) {
      setStatus(`ID ${id} 已存在`);
      return;
    }
    const next = structuredClone(draft);
    const record = source ? structuredClone(source) : createTemplate(category, id);
    record.id = id;
    recordsOf(next, category)[id] = record;
    replaceDraft(next, `已新增 ${id}`);
    setSelectedId(id);
  }

  function deleteRecord(): void {
    if (!selectedId) return;
    if (!window.confirm(`确认删除 ${selectedId}？相关引用不会自动删除。`)) return;
    const next = structuredClone(draft);
    delete recordsOf(next, category)[selectedId];
    replaceDraft(next, `已删除 ${selectedId}`);
    setSelectedId("");
  }

  async function importCatalog(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const nextIssues = validateCatalog(parsed);
      if (nextIssues.some((issue) => issue.level === "error")) {
        setStatus(`导入失败：发现 ${nextIssues.length} 个配置问题`);
        return;
      }
      replaceDraft(parsed as Catalog, `已导入 ${file.name}`);
      setBundledChanged(false);
      setSelectedId("");
    } catch {
      setStatus("导入失败：文件不是有效的 Catalog JSON");
    }
  }

  function applyToDemo(): void {
    const nextIssues = publishCatalog(draft);
    if (nextIssues.some((issue) => issue.level === "error")) {
      setStatus(`无法应用：请先修复 ${nextIssues.length} 个配置问题`);
      return;
    }
    if (
      window.confirm(
        "配置已通过校验。应用新配置需要重置当前 Demo 存档，是否继续？",
      )
    ) {
      clearGame();
      setSource("published");
      setBundledChanged(false);
      setStatus("已应用配置并重置 Demo 存档");
    }
  }

  async function inspectBundledPublish(): Promise<void> {
    if (dirty) {
      setStatus("当前记录还有未保存修改，请先保存这条记录再发布");
      return;
    }
    setPublishBusy(true);
    setPublishError("");
    try {
      const result = await postCatalogPublishRequest(
        "/__idle-config/preview-publish",
        { catalog: draft },
      );
      setPublishPreview(result);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "无法生成发布预览。");
      setStatus("无法检查游戏数据变更");
    } finally {
      setPublishBusy(false);
    }
  }

  async function confirmBundledPublish(): Promise<void> {
    if (!publishPreview || !publishPreview.ok) return;
    setPublishBusy(true);
    setPublishError("");
    try {
      const result = await postCatalogPublishRequest(
        "/__idle-config/publish-bundled",
        {
          catalog: draft,
          expectedFingerprint: publishPreview.currentFingerprint,
          expectedCandidateFingerprint: publishPreview.candidateFingerprint,
        },
      );
      if (!result.ok) {
        setPublishPreview(result);
        setPublishError(result.error ?? "覆盖失败，请重新检查配置。");
        return;
      }
      // 代码内置目录已经成为唯一真源，清掉浏览器覆盖层，避免下次启动仍读旧草稿。
      clearLocalCatalogOverrides();
      clearGame();
      setStatus("游戏数据已覆盖，Demo 存档已重置，正在重新载入");
      setPublishPreview(null);
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "覆盖游戏数据失败。");
    } finally {
      setPublishBusy(false);
    }
  }

  function restoreDefaults(): void {
    if (!window.confirm("确认用代码内置配置覆盖当前草稿？")) return;
    clearPublishedCatalog();
    const next = resetCatalogDraft();
    setDraft(next);
    setSource("draft");
    setBundledChanged(false);
    setSelectedId("");
    setStatus("已恢复内置配置；Demo 现在读代码内置目录");
  }

  return (
    <div className="config-app">
      <header className="config-topbar">
        <div className="config-title">
          <button
            className="config-back"
            onClick={() => window.location.assign(window.location.pathname)}
          >
            ← 返回 Demo
          </button>
          <div>
            <h1>策划配置台</h1>
            <p>本地草稿 · 开发模式可发布到代码内置目录</p>
          </div>
        </div>
        <div className="config-actions">
          <span className={errors.length ? "config-health error" : "config-health"}>
            {errors.length ? `${errors.length} 个错误` : "校验通过"}
            {!!warnings.length && ` · ${warnings.length} 个提醒`}
          </span>
          <button onClick={() => importRef.current?.click()}>导入 JSON</button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={importCatalog}
          />
          <button onClick={() => downloadCatalog(draft)}>导出 JSON</button>
          <button onClick={restoreDefaults}>恢复默认</button>
          <button disabled={publishBusy} onClick={inspectBundledPublish}>
            {publishBusy ? "检查中…" : "覆盖游戏数据"}
          </button>
          <button
            className="config-primary"
            disabled={Boolean(errors.length)}
            onClick={applyToDemo}
          >
            应用到 Demo
          </button>
        </div>
      </header>

      <div className="config-status">
        <span>{status}</span>
        <span
          className={`config-source ${divergedFromBundled ? "diverged" : ""}`}
          title="配置台优先读 localStorage，代码内置只是兜底"
        >
          数据来源：{SOURCE_LABELS[source]}
          {source !== "bundled" &&
            (divergedFromBundled ? " · 已偏离代码内置" : " · 与代码内置一致")}
        </span>
      </div>

      {bundledChanged && (
        <div className="config-bundled-banner">
          <div>
            <strong>代码内置目录已更新</strong>
            <span>
              你本地这份是基于旧版内置目录建立的。
              {bundledDiff.length
                ? bundledDiff
                    .map(
                      (entry) =>
                        `${CATEGORY_META[entry.category].label}：` +
                        [
                          entry.added.length ? `多 ${entry.added.length}` : "",
                          entry.removed.length
                            ? `少 ${entry.removed.length}`
                            : "",
                          entry.changed.length ? `改 ${entry.changed.length}` : "",
                        ]
                          .filter(Boolean)
                          .join("、"),
                    )
                    .join("；")
                : "内容目前一致。"}
            </span>
          </div>
          <div className="config-bundled-actions">
            <button className="config-primary" onClick={restoreDefaults}>
              用内置覆盖
            </button>
            <button
              onClick={() => {
                acknowledgeBundledUpdate();
                setBundledChanged(false);
                setStatus("已保留本地草稿，不再提示这一版内置更新");
              }}
            >
              继续用草稿
            </button>
          </div>
        </div>
      )}

      <main className="config-workspace">
        <nav className="config-categories">
          {CATEGORY_ORDER.map((categoryId) => {
            const meta = CATEGORY_META[categoryId];
            return (
              <button
                className={category === categoryId ? "active" : ""}
                key={categoryId}
                onClick={() => changeCategory(categoryId)}
              >
                <span>
                  <strong>{meta.label}</strong>
                  <small>{meta.description}</small>
                </span>
                <i>{Object.keys(draft[categoryId]).length}</i>
              </button>
            );
          })}
        </nav>

        <section className="config-records">
          <div className="config-section-head">
            <div>
              <h2>{CATEGORY_META[category].label}</h2>
              <span>{recordEntries.length} 条记录</span>
            </div>
            <button className="config-add" onClick={() => addRecord()}>
              ＋ 新增
            </button>
          </div>
          <input
            className="config-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索 ID 或名称"
          />
          {supportsRarity && (
            <div className="config-item-filters">
              <div className="config-rarity-filter">
                <button
                  className={rarityFilter === "all" ? "active" : ""}
                  onClick={() => setRarityFilter("all")}
                >
                  全部<i>{searchMatches.length}</i>
                </button>
                {RARITIES.map((rarity) => (
                  <button
                    className={rarityFilter === rarity ? "active" : ""}
                    key={rarity}
                    onClick={() =>
                      setRarityFilter(rarityFilter === rarity ? "all" : rarity)
                    }
                  >
                    <em className={`rarity-${rarity}`}>
                      {RARITY_LABELS[rarity]}
                    </em>
                    <i>{rarityCounts.get(rarity) ?? 0}</i>
                  </button>
                ))}
              </div>
              <label className="config-item-tag-filter">
                <span>物品 Tag</span>
                <select
                  value={itemTagFilter}
                  onChange={(event) => setItemTagFilter(event.target.value)}
                >
                  <option value="all">全部 Tag（{rarityMatches.length}）</option>
                  {availableItemTags.map((tag) => (
                    <option key={tag} value={tag}>
                      {itemTagLabel(tag)}（{itemTagCounts.counts.get(tag) ?? 0}）
                    </option>
                  ))}
                  <option value="untagged">
                    无 Tag（{itemTagCounts.untagged}）
                  </option>
                </select>
              </label>
            </div>
          )}
          <div className="config-record-list">
            {!recordEntries.length && <p className="config-empty">暂无记录</p>}
            {recordEntries.map(([id, record]) => {
              const icon = supportsRarity ? lootIconUrl(id) : undefined;
              return (
                <button
                  className={`${selectedId === id ? "active" : ""} ${
                    supportsRarity ? "with-icon" : ""
                  }`}
                  key={id}
                  onClick={() => setSelectedId(id)}
                >
                  {supportsRarity &&
                    (icon ? (
                      <img
                        className="config-record-icon"
                        src={icon}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="config-record-icon empty" title="缺图标">
                        ?
                      </span>
                    ))}
                  <span className="config-record-text">
                    <strong>
                      <span className="config-record-name">
                        {displayName(record, id)}
                      </span>
                      {itemTagsOf(record).map((tag) => (
                        <em className="config-record-tag" key={tag}>
                          {itemTagLabel(tag)}
                        </em>
                      ))}
                    </strong>
                    <code>{id}</code>
                    <small>{recordDetail(category, record)}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="config-editor">
          {selectedId ? (
            <>
              <div className="config-editor-head">
                <div>
                  <span>正在编辑</span>
                  <h2>{selectedId}</h2>
                </div>
                <div>
                  <button onClick={() => addRecord(records[selectedId])}>
                    复制
                  </button>
                  <button className="config-delete" onClick={deleteRecord}>
                    删除
                  </button>
                </div>
              </div>
              <div className="config-editor-help">
                <span>
                  {hiddenByFilter
                    ? `这条记录不在当前${[
                        hiddenByRarity
                          ? `稀有度「${RARITY_LABELS[rarityFilter as Rarity]}」`
                          : "",
                        hiddenByItemTag
                          ? itemTagFilter === "untagged"
                            ? "「无 Tag」"
                            : `Tag「${itemTagLabel(itemTagFilter)}」`
                          : "",
                      ]
                        .filter(Boolean)
                        .join("与")}筛选结果里，仍可编辑。`
                    : "编辑单条记录。ID 保持不变；关联字段使用其他记录的 ID。"}
                </span>
                {supportsForm && (
                  <div className="config-modes">
                    <button
                      className={effectiveMode === "form" ? "active" : ""}
                      onClick={() => setMode("form")}
                    >
                      表单
                    </button>
                    <button
                      className={effectiveMode === "json" ? "active" : ""}
                      onClick={() => setMode("json")}
                    >
                      Raw JSON
                    </button>
                  </div>
                )}
              </div>

              {effectiveMode === "form" ? (
                parsedRecord ? (
                  category === "maps" ? (
                    <MapForm
                      key={`${selectedId}-${mode}`}
                      record={parsedRecord}
                      catalog={draft}
                      onChange={(next) => {
                        setEditorText(JSON.stringify(next, null, 2));
                        setEditorError("");
                      }}
                      onSave={(next) => saveRecord(next)}
                    />
                  ) : category === "events" ? (
                    <EventForm
                      key={`${selectedId}-${mode}`}
                      record={parsedRecord}
                      catalog={draft}
                      onChange={(next) => {
                        setEditorText(JSON.stringify(next, null, 2));
                        setEditorError("");
                      }}
                    />
                  ) : category === "eventPools" ? (
                    <EventPoolForm
                      key={`${selectedId}-${mode}`}
                      record={parsedRecord}
                      catalog={draft}
                      onChange={(next) => {
                        setEditorText(JSON.stringify(next, null, 2));
                        setEditorError("");
                      }}
                    />
                  ) : category === "petTemplates" ? (
                    <PetForm
                      key={mode}
                      record={parsedRecord}
                      catalog={draft}
                      onChange={(next) => {
                        setEditorText(JSON.stringify(next, null, 2));
                        setEditorError("");
                      }}
                    />
                  ) : category === "tasks" ? (
                    <TaskForm
                      key={mode}
                      record={parsedRecord}
                      catalog={draft}
                      onChange={(next) => {
                        setEditorText(JSON.stringify(next, null, 2));
                        setEditorError("");
                      }}
                    />
                  ) : (
                    <ItemForm
                      key={mode}
                      record={parsedRecord}
                      catalog={draft}
                      onChange={(next) => {
                        setEditorText(JSON.stringify(next, null, 2));
                        setEditorError("");
                      }}
                    />
                  )
                ) : (
                  <p className="config-empty">
                    当前 JSON 无法解析，请切到 Raw JSON 修复后再用表单。
                  </p>
                )
              ) : (
                <textarea
                  value={editorText}
                  spellCheck={false}
                  onChange={(event) => {
                    setEditorText(event.target.value);
                    setEditorError("");
                  }}
                />
              )}

              {editorError && <p className="config-editor-error">{editorError}</p>}
              <button className="config-save" onClick={() => saveRecord()}>
                保存这条记录{dirty ? " · 有未保存修改" : ""}
              </button>
            </>
          ) : (
            <p className="config-empty">选择或新增一条记录开始编辑。</p>
          )}
        </section>

        <aside className="config-issues">
          <div>
            <h2>配置检查</h2>
            <span>{issues.length ? `${issues.length} 项` : "没有问题"}</span>
          </div>
          {!issues.length && (
            <p className="config-ok">所有引用和地图结构均通过检查。</p>
          )}
          <ol>
            {issues.map((issue, index) => (
              <li className={issue.level} key={`${issue.path}-${index}`}>
                <code>{issue.path}</code>
                <span>{issue.message}</span>
              </li>
            ))}
          </ol>
        </aside>
      </main>

      {(publishPreview || publishError) && (
        <div
          className="config-publish-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !publishBusy) {
              setPublishPreview(null);
              setPublishError("");
            }
          }}
        >
          <section
            className="config-publish-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="config-publish-title"
          >
            <div className="config-publish-head">
              <div>
                <span>发布预检</span>
                <h2 id="config-publish-title">覆盖内置游戏数据</h2>
              </div>
              <button
                type="button"
                disabled={publishBusy}
                onClick={() => {
                  setPublishPreview(null);
                  setPublishError("");
                }}
              >
                ×
              </button>
            </div>

            {publishError && <p className="config-publish-error">{publishError}</p>}

            {publishPreview && (
              <>
                <p className="config-publish-target">
                  覆盖目标：<code>{publishPreview.target}</code>
                </p>
                <div className="config-publish-validation">
                  <strong>
                    {publishPreview.issues.some((issue) => issue.level === "error")
                      ? "校验未通过"
                      : "校验通过"}
                  </strong>
                  <span>
                    {publishPreview.issues.filter((issue) => issue.level === "error").length} 个错误 · {publishPreview.issues.filter((issue) => issue.level === "warning").length} 个提醒
                  </span>
                </div>

                {!!publishPreview.issues.length && (
                  <ol className="config-publish-issues">
                    {publishPreview.issues.map((issue, index) => (
                      <li className={issue.level} key={`${issue.path}-${index}`}>
                        <code>{issue.path}</code>
                        <span>{issue.message}</span>
                      </li>
                    ))}
                  </ol>
                )}

                <div className="config-publish-changes">
                  <h3>变更摘要</h3>
                  {!publishPreview.changes.length ? (
                    <p>
                      {publishPreview.ok
                        ? "草稿与当前游戏数据完全一致，没有内容需要覆盖。"
                        : "修复校验错误后才能计算可靠的变更摘要。"}
                    </p>
                  ) : (
                    publishPreview.changes.map((entry) => (
                      <article key={entry.category}>
                        <strong>{CATEGORY_META[entry.category].label}</strong>
                        {!!entry.added.length && (
                          <p className="added">新增 {entry.added.length}：{entry.added.join("、")}</p>
                        )}
                        {!!entry.removed.length && (
                          <p className="removed">删除 {entry.removed.length}：{entry.removed.join("、")}</p>
                        )}
                        {!!entry.changed.length && (
                          <p className="changed">修改 {entry.changed.length}：{entry.changed.join("、")}</p>
                        )}
                      </article>
                    ))
                  )}
                </div>

                <p className="config-publish-warning">
                  确认后会原子覆盖内置 JSON，并重置当前 Demo 存档。此操作只在本地开发服务器中可用。
                </p>
                <div className="config-publish-actions">
                  <button
                    type="button"
                    disabled={publishBusy}
                    onClick={() => setPublishPreview(null)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="config-primary"
                    disabled={
                      publishBusy ||
                      !publishPreview.ok ||
                      !publishPreview.changes.length
                    }
                    onClick={confirmBundledPublish}
                  >
                    {publishBusy ? "正在覆盖…" : "确认覆盖游戏数据"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
