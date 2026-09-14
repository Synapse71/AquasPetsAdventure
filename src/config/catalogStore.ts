import {
  bundledCatalog,
  setCatalog,
} from "../domain/catalog";
import { SECONDARY_STAT_KEYS, secondaryStatCap } from "../domain/engine";
import { ITEM_TAGS, isKnownItemTag } from "../domain/itemTags";
import { isPlayerMilestoneId } from "../domain/milestones";
import { RARITIES, isRarity } from "../domain/rarity";
import type { Catalog, SecondaryStatKey } from "../domain/types";
import { normalizeStartTravelDuration } from '../domain/expeditionTiming';

// v6 以 2026-08-20 重新导出的策划目录为新基线。
// 旧 localStorage 仍保留但不再覆盖这次明确要求导入的新目录。
const DRAFT_KEY = "idle-pet-adventure.catalog.draft.v6";
const PUBLISHED_KEY = "idle-pet-adventure.catalog.published.v6";
// 记录本地数据是基于哪一版代码内置目录建立的。
const BASELINE_KEY = "idle-pet-adventure.catalog.baseline.v6";

export type CatalogCategory = keyof Catalog;

export interface CatalogIssue {
  level: "error" | "warning";
  path: string;
  message: string;
}

const EVENT_STAT_KEYS = ["fitness", "perception", "technique"] as const;

function cloneCatalog(value: Catalog): Catalog {
  return normalizeStartTravelDuration(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordSection(
  root: Record<string, unknown>,
  key: CatalogCategory,
  issues: CatalogIssue[],
): Record<string, unknown> {
  const value = root[key];
  if (!isRecord(value)) {
    issues.push({ level: "error", path: key, message: "必须是以 ID 为键的对象。" });
    return {};
  }
  return value;
}

// 次要属性门禁：{ stat, value }。用单对象而不是「属性 → 数值」的映射，
// 是因为设计上一个门禁只对应一项次要属性（不变量 17 的配套约束）。
function checkSecondaryRequirement(
  value: unknown,
  path: string,
  issues: CatalogIssue[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({
      level: "error",
      path,
      message: "次要属性门禁必须是对象 { stat, value }。",
    });
    return;
  }
  if (!SECONDARY_STAT_KEYS.includes(value.stat as SecondaryStatKey)) {
    issues.push({
      level: "error",
      path: `${path}.stat`,
      message: `次要属性必须是 ${SECONDARY_STAT_KEYS.join(" / ")} 之一。`,
    });
  }
  if (
    typeof value.value !== "number" ||
    !Number.isInteger(value.value) ||
    value.value < 1
  ) {
    issues.push({
      level: "error",
      path: `${path}.value`,
      message: "门槛数值必须是不小于 1 的整数。",
    });
  } else if (value.value > secondaryStatCap()) {
    issues.push({
      level: "warning",
      path: `${path}.value`,
      message: `门槛 ${value.value} 高于次要属性上限 ${secondaryStatCap()}，任何宠物都无法达到。`,
    });
  }
}

function checkInventoryReferences(
  value: unknown,
  path: string,
  itemIds: Set<string>,
  issues: CatalogIssue[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({ level: "error", path, message: "物品清单必须是对象。" });
    return;
  }
  for (const [itemId, quantity] of Object.entries(value)) {
    if (!itemIds.has(itemId)) {
      issues.push({
        level: "error",
        path: `${path}.${itemId}`,
        message: `引用了不存在的物品 ${itemId}。`,
      });
    }
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      issues.push({
        level: "error",
        path: `${path}.${itemId}`,
        message: "数量必须是不小于 1 的整数。",
      });
    }
  }
}

function checkNodeLoot(
  value: unknown,
  path: string,
  items: Record<string, unknown>,
  issues: CatalogIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({
      level: "error",
      path,
      message: "节点必须配置一个掉落表，并选择 independent 或 composition 模式。",
    });
    return;
  }

  const minCount = value.minCount;
  const maxCount = value.maxCount;
  const validMin =
    typeof minCount === "number" && Number.isInteger(minCount) && minCount >= 1;
  const validMax =
    typeof maxCount === "number" && Number.isInteger(maxCount) && maxCount >= 1;
  if (!validMin) {
    issues.push({
      level: "error",
      path: `${path}.minCount`,
      message: "最小掉落数量必须是不小于 1 的整数。",
    });
  }
  if (!validMax) {
    issues.push({
      level: "error",
      path: `${path}.maxCount`,
      message: "最大掉落数量必须是不小于 1 的整数。",
    });
  }
  if (validMin && validMax && minCount > maxCount) {
    issues.push({
      level: "error",
      path: `${path}.maxCount`,
      message: "最大掉落数量不能小于最小掉落数量。",
    });
  }

  const readItemList = (key: "whitelistItemIds" | "blacklistItemIds") => {
    const raw = value[key];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      issues.push({
        level: "error",
        path: `${path}.${key}`,
        message: "物品过滤名单必须是物品 ID 数组。",
      });
      return [];
    }
    const result: string[] = [];
    const seen = new Set<string>();
    for (const [index, itemId] of raw.entries()) {
      if (typeof itemId !== "string" || !Object.hasOwn(items, itemId)) {
        issues.push({
          level: "error",
          path: `${path}.${key}.${index}`,
          message: `引用了不存在的物品 ${String(itemId)}。`,
        });
        continue;
      }
      if (seen.has(itemId)) {
        issues.push({
          level: "error",
          path: `${path}.${key}.${index}`,
          message: `过滤名单中重复出现物品 ${itemId}。`,
        });
        continue;
      }
      seen.add(itemId);
      result.push(itemId);
    }
    return result;
  };

  const whitelist = readItemList("whitelistItemIds");
  const blacklist = readItemList("blacklistItemIds");
  const blacklistSet = new Set(blacklist);
  for (const itemId of whitelist) {
    if (blacklistSet.has(itemId)) {
      issues.push({
        level: "error",
        path: `${path}.blacklistItemIds`,
        message: `物品 ${itemId} 不能同时出现在白名单和黑名单。`,
      });
    }
    const item = items[itemId];
    if (isRecord(item) && typeof item.tagGrantId === "string") {
      issues.push({
        level: "error",
        path: `${path}.whitelistItemIds`,
        message: `Tag 成长道具 ${itemId} 不能进入普通随机掉落池。`,
      });
    }
  }

  const availableItemTags = new Set<string>();
  for (const item of Object.values(items)) {
    if (!isRecord(item) || !Array.isArray(item.tags)) continue;
    for (const tag of item.tags) {
      if (typeof tag === "string" && tag.trim()) availableItemTags.add(tag);
    }
  }
  const readItemTagList = (
    key: "whitelistItemTags" | "blacklistItemTags",
  ): string[] => {
    const raw = value[key];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      issues.push({
        level: "error",
        path: `${path}.${key}`,
        message: "物品 Tag 过滤名单必须是字符串数组。",
      });
      return [];
    }
    const result: string[] = [];
    const seen = new Set<string>();
    for (const [index, tag] of raw.entries()) {
      if (typeof tag !== "string" || !availableItemTags.has(tag)) {
        issues.push({
          level: "error",
          path: `${path}.${key}.${index}`,
          message: `引用了没有任何物品使用的物品 Tag ${String(tag)}。`,
        });
        continue;
      }
      if (seen.has(tag)) {
        issues.push({
          level: "error",
          path: `${path}.${key}.${index}`,
          message: `过滤名单中重复出现物品 Tag ${tag}。`,
        });
        continue;
      }
      seen.add(tag);
      result.push(tag);
    }
    return result;
  };
  const whitelistTags = readItemTagList("whitelistItemTags");
  const blacklistTags = readItemTagList("blacklistItemTags");
  const blacklistTagSet = new Set(blacklistTags);
  for (const tag of whitelistTags) {
    if (blacklistTagSet.has(tag)) {
      issues.push({
        level: "error",
        path: `${path}.blacklistItemTags`,
        message: `物品 Tag ${tag} 不能同时出现在白名单和黑名单。`,
      });
    }
  }

  const eligibleByRarity = (rarity: string): boolean =>
    Object.entries(items).some(([itemId, item]) => {
      if (!isRecord(item) || item.rarity !== rarity) return false;
      if (typeof item.tagGrantId === "string") return false;
      const itemTags = Array.isArray(item.tags)
        ? item.tags.filter((tag): tag is string => typeof tag === "string")
        : [];
      const matchesWhitelist =
        (!whitelist.length && !whitelistTags.length) ||
        whitelist.includes(itemId) ||
        itemTags.some((tag) => whitelistTags.includes(tag));
      const matchesBlacklist =
        blacklistSet.has(itemId) ||
        itemTags.some((tag) => blacklistTagSet.has(tag));
      return matchesWhitelist && !matchesBlacklist;
    });

  const requiredRarities = new Set<string>();
  if (value.mode === "independent") {
    if (!isRecord(value.rarityWeights)) {
      issues.push({
        level: "error",
        path: `${path}.rarityWeights`,
        message: "独立抽取必须配置稀有度权重对象。",
      });
    } else {
      let positive = false;
      for (const [rarity, weight] of Object.entries(value.rarityWeights)) {
        if (!isRarity(rarity)) {
          issues.push({
            level: "error",
            path: `${path}.rarityWeights.${rarity}`,
            message: `未知稀有度 ${rarity}。`,
          });
          continue;
        }
        if (
          typeof weight !== "number" ||
          !Number.isFinite(weight) ||
          weight < 0
        ) {
          issues.push({
            level: "error",
            path: `${path}.rarityWeights.${rarity}`,
            message: "稀有度权重必须是非负数字。",
          });
        } else if (weight > 0) {
          positive = true;
          requiredRarities.add(rarity);
        }
      }
      if (!positive) {
        issues.push({
          level: "error",
          path: `${path}.rarityWeights`,
          message: "至少需要一个大于 0 的稀有度权重。",
        });
      }
    }

    if (value.countWeights !== undefined) {
      if (!isRecord(value.countWeights)) {
        issues.push({
          level: "error",
          path: `${path}.countWeights`,
          message: "数量权重必须是“数量 → 权重”的对象。",
        });
      } else {
        let positive = false;
        for (const [countText, weight] of Object.entries(value.countWeights)) {
          const count = Number(countText);
          if (
            !Number.isInteger(count) ||
            (validMin && count < minCount) ||
            (validMax && count > maxCount)
          ) {
            issues.push({
              level: "error",
              path: `${path}.countWeights.${countText}`,
              message: "数量权重的键必须是掉落数量范围内的整数。",
            });
          }
          if (
            typeof weight !== "number" ||
            !Number.isFinite(weight) ||
            weight < 0
          ) {
            issues.push({
              level: "error",
              path: `${path}.countWeights.${countText}`,
              message: "数量权重必须是非负数字。",
            });
          } else if (weight > 0) {
            positive = true;
          }
        }
        if (!positive) {
          issues.push({
            level: "error",
            path: `${path}.countWeights`,
            message: "至少需要一个大于 0 的数量权重。",
          });
        }
      }
    }
  } else if (value.mode === "composition") {
    if (!Array.isArray(value.compositions) || !value.compositions.length) {
      issues.push({
        level: "error",
        path: `${path}.compositions`,
        message: "组合表至少需要一个掉落组合。",
      });
    } else {
      const compositionIds = new Set<string>();
      for (const [index, composition] of value.compositions.entries()) {
        const compositionPath = `${path}.compositions.${index}`;
        if (!isRecord(composition)) {
          issues.push({
            level: "error",
            path: compositionPath,
            message: "掉落组合必须是对象。",
          });
          continue;
        }
        if (typeof composition.id !== "string" || !composition.id.trim()) {
          issues.push({
            level: "error",
            path: `${compositionPath}.id`,
            message: "掉落组合必须有唯一 ID。",
          });
        } else if (compositionIds.has(composition.id)) {
          issues.push({
            level: "error",
            path: `${compositionPath}.id`,
            message: `掉落组合 ID ${composition.id} 重复。`,
          });
        } else {
          compositionIds.add(composition.id);
        }
        if (
          typeof composition.weight !== "number" ||
          !Number.isFinite(composition.weight) ||
          composition.weight <= 0
        ) {
          issues.push({
            level: "error",
            path: `${compositionPath}.weight`,
            message: "组合权重必须是大于 0 的数字。",
          });
        }
        if (!isRecord(composition.rarityCounts)) {
          issues.push({
            level: "error",
            path: `${compositionPath}.rarityCounts`,
            message: "组合必须配置各稀有度的数量。",
          });
          continue;
        }
        let total = 0;
        for (const [rarity, count] of Object.entries(composition.rarityCounts)) {
          if (!isRarity(rarity)) {
            issues.push({
              level: "error",
              path: `${compositionPath}.rarityCounts.${rarity}`,
              message: `未知稀有度 ${rarity}。`,
            });
            continue;
          }
          if (
            typeof count !== "number" ||
            !Number.isInteger(count) ||
            count < 0
          ) {
            issues.push({
              level: "error",
              path: `${compositionPath}.rarityCounts.${rarity}`,
              message: "组合中的稀有度数量必须是非负整数。",
            });
          } else {
            total += count;
            if (count > 0) requiredRarities.add(rarity);
          }
        }
        if (total < 1) {
          issues.push({
            level: "error",
            path: `${compositionPath}.rarityCounts`,
            message: "掉落组合至少需要包含 1 件物品。",
          });
        } else if (
          (validMin && total < minCount) ||
          (validMax && total > maxCount)
        ) {
          issues.push({
            level: "error",
            path: `${compositionPath}.rarityCounts`,
            message: `组合总数 ${total} 不在 ${String(minCount)}～${String(maxCount)} 范围内。`,
          });
        }
      }
    }
  } else {
    issues.push({
      level: "error",
      path: `${path}.mode`,
      message: "掉落模式必须是 independent 或 composition。",
    });
  }

  for (const rarity of requiredRarities) {
    if (!eligibleByRarity(rarity)) {
      issues.push({
        level: "error",
        path,
        message: `${rarity} 档经过白名单和黑名单过滤后没有可抽取物品。`,
      });
    }
  }
}

export function validateCatalog(value: unknown): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  if (!isRecord(value)) {
    return [{ level: "error", path: "catalog", message: "配置根节点必须是对象。" }];
  }

  const allowedSections = new Set<CatalogCategory>([
    "items",
    "tags",
    "maps",
    "events",
    "eventPools",
    "tasks",
    "petTemplates",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedSections.has(key as CatalogCategory)) {
      issues.push({
        level: "error",
        path: key,
        message: "配置根节点包含未知分类。",
      });
    }
  }

  const items = recordSection(value, "items", issues);
  const tags = recordSection(value, "tags", issues);
  const maps = recordSection(value, "maps", issues);
  const events = recordSection(value, "events", issues);
  const eventPools = recordSection(value, "eventPools", issues);
  const tasks = recordSection(value, "tasks", issues);
  const petTemplates = recordSection(value, "petTemplates", issues);

  const sections: [CatalogCategory, Record<string, unknown>][] = [
    ["items", items],
    ["tags", tags],
    ["maps", maps],
    ["events", events],
    ["eventPools", eventPools],
    ["tasks", tasks],
    ["petTemplates", petTemplates],
  ];

  for (const [sectionName, section] of sections) {
    for (const [key, entry] of Object.entries(section)) {
      if (!isRecord(entry)) {
        issues.push({
          level: "error",
          path: `${sectionName}.${key}`,
          message: "记录必须是对象。",
        });
      } else if (entry.id !== key) {
        issues.push({
          level: "error",
          path: `${sectionName}.${key}.id`,
          message: `记录 id 必须与键名 ${key} 一致。`,
        });
      }
    }
  }

  if (!Object.keys(maps).length) {
    issues.push({ level: "error", path: "maps", message: "至少需要一张地图。" });
  }
  if (!Object.keys(petTemplates).length) {
    issues.push({
      level: "error",
      path: "petTemplates",
      message: "至少需要一个宠物模板。",
    });
  }

  const itemIds = new Set(Object.keys(items));
  const tagIds = new Set(Object.keys(tags));
  const mapIds = new Set(Object.keys(maps));
  const eventIds = new Set(Object.keys(events));
  const poolIds = new Set(Object.keys(eventPools));
  const petIds = new Set(Object.keys(petTemplates));

  for (const [itemId, rawItem] of Object.entries(items)) {
    if (!isRecord(rawItem)) continue;
    if (typeof rawItem.name !== "string" || !rawItem.name.trim()) {
      issues.push({
        level: "error",
        path: `items.${itemId}.name`,
        message: "物品名称不能为空。",
      });
    }
    if (!isRarity(rawItem.rarity)) {
      issues.push({
        level: "error",
        path: `items.${itemId}.rarity`,
        message: `稀有度必须是 ${RARITIES.join(" / ")} 之一。`,
      });
    }
    if (typeof rawItem.weight !== "number" || rawItem.weight < 0) {
      issues.push({
        level: "error",
        path: `items.${itemId}.weight`,
        message: "重量必须是非负数字。",
      });
    }
    // 省略即为 1（一件一格）；写了就必须是 ≥1 的整数。
    if (
      rawItem.stackSize !== undefined &&
      (typeof rawItem.stackSize !== "number" ||
        !Number.isInteger(rawItem.stackSize) ||
        rawItem.stackSize < 1)
    ) {
      issues.push({
        level: "error",
        path: `items.${itemId}.stackSize`,
        message: "每格堆叠数必须是不小于 1 的整数，省略表示 1。",
      });
    }
    // 不变量 14：可出售必须是独立必填字段，不能靠 sellValue 的有无来表达。
    if (typeof rawItem.sellable !== "boolean") {
      issues.push({
        level: "error",
        path: `items.${itemId}.sellable`,
        message: "必须显式写明是否可出售（true / false），不能省略。",
      });
    } else if (rawItem.sellable) {
      if (
        typeof rawItem.sellValue !== "number" ||
        !(rawItem.sellValue > 0)
      ) {
        issues.push({
          level: "error",
          path: `items.${itemId}.sellValue`,
          message: "标记为可出售时必须给出大于 0 的价格。",
        });
      }
    } else if (rawItem.sellValue !== undefined) {
      issues.push({
        level: "error",
        path: `items.${itemId}.sellValue`,
        message: "标记为不可出售时不应保留价格字段。",
      });
    }
    if (rawItem.tags !== undefined) {
      if (!Array.isArray(rawItem.tags)) {
        issues.push({
          level: "error",
          path: `items.${itemId}.tags`,
          message: "标签必须是字符串数组。",
        });
      } else {
        const seen = new Set<string>();
        for (const tag of rawItem.tags) {
          if (typeof tag !== "string" || !tag.trim()) {
            issues.push({
              level: "error",
              path: `items.${itemId}.tags`,
              message: "标签必须是非空字符串。",
            });
            continue;
          }
          if (seen.has(tag)) {
            issues.push({
              level: "error",
              path: `items.${itemId}.tags`,
              message: `标签 ${tag} 重复。`,
            });
          }
          seen.add(tag);
          // 允许列表之外的标签，但提醒一声，免得拼错后静默变成新分类。
          if (!isKnownItemTag(tag)) {
            issues.push({
              level: "warning",
              path: `items.${itemId}.tags`,
              message: `标签 ${tag} 不在已知列表（${ITEM_TAGS.join(" / ")}）中。`,
            });
          }
        }
      }
    }
    if (
      typeof rawItem.tagGrantId === "string" &&
      !tagIds.has(rawItem.tagGrantId)
    ) {
      issues.push({
        level: "error",
        path: `items.${itemId}.tagGrantId`,
        message: `引用了不存在的 Tag ${rawItem.tagGrantId}。`,
      });
    }
    // 次要属性成长道具：加成写在物品上，不从稀有度推导，所以这里必须逐字段校验。
    if (rawItem.secondaryGrant !== undefined) {
      const grant = rawItem.secondaryGrant;
      const path = `items.${itemId}.secondaryGrant`;
      if (!isRecord(grant)) {
        issues.push({
          level: "error",
          path,
          message: "成长道具的加成必须是对象 { stat, amount }。",
        });
      } else {
        if (!SECONDARY_STAT_KEYS.includes(grant.stat as SecondaryStatKey)) {
          issues.push({
            level: "error",
            path: `${path}.stat`,
            message: `次要属性必须是 ${SECONDARY_STAT_KEYS.join(" / ")} 之一。`,
          });
        }
        if (
          typeof grant.amount !== "number" ||
          !Number.isInteger(grant.amount) ||
          grant.amount < 1
        ) {
          issues.push({
            level: "error",
            path: `${path}.amount`,
            message: "加成必须是不小于 1 的整数。",
          });
        }
        if (rawItem.tagGrantId !== undefined) {
          issues.push({
            level: "error",
            path,
            message: "一件道具不能同时赋予 Tag 和提升次要属性。",
          });
        }
      }
    }
  }

  for (const [tagId, rawTag] of Object.entries(tags)) {
    if (!isRecord(rawTag)) continue;
    if (
      rawTag.eventRollAdvantage !== undefined &&
      typeof rawTag.eventRollAdvantage !== "boolean"
    ) {
      issues.push({
        level: "error",
        path: `tags.${tagId}.eventRollAdvantage`,
        message: "事件优势骰开关必须是布尔值。",
      });
    }
    if (rawTag.extraRewardChance !== undefined) {
      issues.push({
        level: "warning",
        path: `tags.${tagId}.extraRewardChance`,
        message:
          "extraRewardChance 是旧字段，运行时会按一次、不叠加的事件优势骰处理；请改用 eventRollAdvantage。",
      });
    }
  }

  for (const [poolId, rawPool] of Object.entries(eventPools)) {
    if (!isRecord(rawPool)) continue;
    const ids = rawPool.eventIds;
    if (!Array.isArray(ids) || !ids.length) {
      issues.push({
        level: "error",
        path: `eventPools.${poolId}.eventIds`,
        message: "事件池至少需要一个事件。",
      });
      continue;
    }
    const seenEventIds = new Set<string>();
    for (const eventId of ids) {
      if (typeof eventId !== "string" || !eventIds.has(eventId)) {
        issues.push({
          level: "error",
          path: `eventPools.${poolId}.eventIds`,
          message: `引用了不存在的事件 ${String(eventId)}。`,
        });
      } else if (seenEventIds.has(eventId)) {
        issues.push({
          level: "error",
          path: `eventPools.${poolId}.eventIds`,
          message: `事件 ${eventId} 在同一个事件池中重复。`,
        });
      }
      if (typeof eventId === "string") seenEventIds.add(eventId);
    }
  }

  for (const [eventId, rawEvent] of Object.entries(events)) {
    if (!isRecord(rawEvent)) continue;
    if (typeof rawEvent.title !== "string" || !rawEvent.title.trim()) {
      issues.push({
        level: "error",
        path: `events.${eventId}.title`,
        message: "事件名称不能为空。",
      });
    }
    if (typeof rawEvent.description !== "string") {
      issues.push({
        level: "error",
        path: `events.${eventId}.description`,
        message: "事件描述必须是字符串。",
      });
    }
    const choices = rawEvent.choices;
    if (!Array.isArray(choices) || !choices.length) {
      issues.push({
        level: "error",
        path: `events.${eventId}.choices`,
        message: "事件至少需要一个选项。",
      });
      continue;
    }
    checkSecondaryRequirement(
      rawEvent.requiredSecondary,
      `events.${eventId}.requiredSecondary`,
      issues,
    );
    const seenChoiceIds = new Set<string>();
    for (const [index, rawChoice] of choices.entries()) {
      if (!isRecord(rawChoice)) {
        issues.push({
          level: "error",
          path: `events.${eventId}.choices.${index}`,
          message: "事件选项必须是对象。",
        });
        continue;
      }
      if (typeof rawChoice.id !== "string" || !rawChoice.id.trim()) {
        issues.push({
          level: "error",
          path: `events.${eventId}.choices.${index}.id`,
          message: "选项 ID 不能为空。",
        });
      } else if (seenChoiceIds.has(rawChoice.id)) {
        issues.push({
          level: "error",
          path: `events.${eventId}.choices.${index}.id`,
          message: `选项 ID ${rawChoice.id} 在事件内重复。`,
        });
      } else {
        seenChoiceIds.add(rawChoice.id);
      }
      if (typeof rawChoice.label !== "string" || !rawChoice.label.trim()) {
        issues.push({
          level: "error",
          path: `events.${eventId}.choices.${index}.label`,
          message: "选项文本不能为空。",
        });
      }
      if (typeof rawChoice.description !== "string") {
        issues.push({
          level: "error",
          path: `events.${eventId}.choices.${index}.description`,
          message: "选项说明必须是字符串。",
        });
      }
      const choicePath = `events.${eventId}.choices.${index}`;
      const resolution = rawChoice.resolution;
      if (resolution === undefined) {
        if (
          !EVENT_STAT_KEYS.includes(
            rawChoice.stat as (typeof EVENT_STAT_KEYS)[number],
          )
        ) {
          issues.push({
            level: "error",
            path: `${choicePath}.stat`,
            message: `检定主属性必须是 ${EVENT_STAT_KEYS.join(" / ")} 之一。`,
          });
        }
        if (
          typeof rawChoice.difficulty !== "number" ||
          !Number.isInteger(rawChoice.difficulty)
        ) {
          issues.push({
            level: "error",
            path: `${choicePath}.difficulty`,
            message: "事件难度必须是整数。",
          });
        }
      } else if (!isRecord(resolution)) {
        issues.push({
          level: "error",
          path: `${choicePath}.resolution`,
          message: "选项结算方式必须是对象。",
        });
      } else if (resolution.type === "primary") {
        if (
          !EVENT_STAT_KEYS.includes(
            resolution.stat as (typeof EVENT_STAT_KEYS)[number],
          )
        ) {
          issues.push({
            level: "error",
            path: `${choicePath}.resolution.stat`,
            message: `检定主属性必须是 ${EVENT_STAT_KEYS.join(" / ")} 之一。`,
          });
        }
        if (
          typeof resolution.difficulty !== "number" ||
          !Number.isInteger(resolution.difficulty)
        ) {
          issues.push({
            level: "error",
            path: `${choicePath}.resolution.difficulty`,
            message: "事件难度必须是整数。",
          });
        }
      } else if (resolution.type === "secondary") {
        const validStat = SECONDARY_STAT_KEYS.includes(
          resolution.stat as SecondaryStatKey,
        );
        if (!validStat) {
          issues.push({
            level: "error",
            path: `${choicePath}.resolution.stat`,
            message: `次要属性必须是 ${SECONDARY_STAT_KEYS.join(" / ")} 之一。`,
          });
        }
        const successThreshold = resolution.successThreshold;
        const extraSuccessThreshold = resolution.extraSuccessThreshold;
        const validSuccess =
          typeof successThreshold === "number" &&
          Number.isInteger(successThreshold) &&
          successThreshold >= 1;
        if (!validSuccess) {
          issues.push({
            level: "error",
            path: `${choicePath}.resolution.successThreshold`,
            message: "成功门槛必须是不小于 1 的整数。",
          });
        }
        const validExtra =
          typeof extraSuccessThreshold === "number" &&
          Number.isInteger(extraSuccessThreshold) &&
          extraSuccessThreshold >= 1;
        if (!validExtra) {
          issues.push({
            level: "error",
            path: `${choicePath}.resolution.extraSuccessThreshold`,
            message: "大成功门槛必须是不小于 1 的整数。",
          });
        } else if (
          validSuccess &&
          (extraSuccessThreshold as number) <= (successThreshold as number)
        ) {
          issues.push({
            level: "error",
            path: `${choicePath}.resolution.extraSuccessThreshold`,
            message: "大成功门槛必须高于成功门槛。",
          });
        }
        if (
          validExtra &&
          (extraSuccessThreshold as number) > secondaryStatCap()
        ) {
          issues.push({
            level: "warning",
            path: `${choicePath}.resolution.extraSuccessThreshold`,
            message: `大成功门槛 ${String(extraSuccessThreshold)} 高于次要属性上限 ${secondaryStatCap()}，当前无法达到。`,
          });
        }
      } else if (resolution.type === "leave") {
        if (isRecord(rawChoice.rewards) && Object.keys(rawChoice.rewards).length) {
          issues.push({
            level: "error",
            path: `${choicePath}.rewards`,
            message: "直接离开不能配置事件奖励。",
          });
        }
        if (
          isRecord(rawChoice.bonusRewards) &&
          Object.keys(rawChoice.bonusRewards).length
        ) {
          issues.push({
            level: "error",
            path: `${choicePath}.bonusRewards`,
            message: "直接离开不能配置额外奖励。",
          });
        }
        if (
          rawChoice.requiredTagId !== undefined ||
          rawChoice.requiredSecondary !== undefined
        ) {
          issues.push({
            level: "error",
            path: `${choicePath}.resolution`,
            message: "直接离开必须始终可选，不能配置 Tag 或次要属性门槛。",
          });
        }
      } else {
        issues.push({
          level: "error",
          path: `${choicePath}.resolution.type`,
          message: "选项类型必须是 primary、secondary 或 leave。",
        });
      }
      if (!isRecord(rawChoice.rewards)) {
        issues.push({
          level: "error",
          path: `events.${eventId}.choices.${index}.rewards`,
          message: "事件奖励必须是物品清单；没有奖励时请使用空对象。",
        });
      }
      checkInventoryReferences(
        rawChoice.rewards,
        `events.${eventId}.choices.${index}.rewards`,
        itemIds,
        issues,
      );
      checkInventoryReferences(
        rawChoice.bonusRewards,
        `events.${eventId}.choices.${index}.bonusRewards`,
        itemIds,
        issues,
      );
      if (
        rawChoice.requiredTagId !== undefined &&
        (typeof rawChoice.requiredTagId !== "string" ||
          !tagIds.has(rawChoice.requiredTagId))
      ) {
        issues.push({
          level: "error",
          path: `events.${eventId}.choices.${index}.requiredTagId`,
          message: `引用了不存在的 Tag ${rawChoice.requiredTagId}。`,
        });
      }
      checkSecondaryRequirement(
        rawChoice.requiredSecondary,
        `events.${eventId}.choices.${index}.requiredSecondary`,
        issues,
      );
    }
  }

  for (const [mapId, rawMap] of Object.entries(maps)) {
    if (!isRecord(rawMap)) continue;
    const nodes = rawMap.nodes;
    if (!isRecord(nodes) || !Object.keys(nodes).length) {
      issues.push({
        level: "error",
        path: `maps.${mapId}.nodes`,
        message: "地图至少需要一个节点。",
      });
      continue;
    }
    if (
      typeof rawMap.startNodeId !== "string" ||
      !Object.hasOwn(nodes, rawMap.startNodeId)
    ) {
      issues.push({
        level: "error",
        path: `maps.${mapId}.startNodeId`,
        message: "起始节点不存在。",
      });
    }
    if (!isRecord(rawMap.informationThresholds)) {
      issues.push({
        level: "error",
        path: `maps.${mapId}.informationThresholds`,
        message: "地图必须配置部分情报与完整情报的感知阈值。",
      });
    } else {
      const partial = rawMap.informationThresholds.partial;
      const full = rawMap.informationThresholds.full;
      if (!Number.isInteger(partial) || (partial as number) < 0) {
        issues.push({
          level: "error",
          path: `maps.${mapId}.informationThresholds.partial`,
          message: "部分情报阈值必须是不小于 0 的整数。",
        });
      }
      if (!Number.isInteger(full) || (full as number) <= (partial as number)) {
        issues.push({
          level: "error",
          path: `maps.${mapId}.informationThresholds.full`,
          message: "完整情报阈值必须是大于部分情报阈值的整数。",
        });
      }
    }
    // 经验系数乘在节点经验和战利品经验上，省略即为 1。
    if (
      rawMap.xpMultiplier !== undefined &&
      (typeof rawMap.xpMultiplier !== "number" || rawMap.xpMultiplier <= 0)
    ) {
      issues.push({
        level: "error",
        path: `maps.${mapId}.xpMultiplier`,
        message: "经验系数必须是大于 0 的数字，省略表示 1。",
      });
    }
    let terminalCount = 0;
    const adjacency = new Map<string, string[]>();
    for (const [nodeId, rawNode] of Object.entries(nodes)) {
      if (!isRecord(rawNode)) continue;
      const isStartNode = rawMap.startNodeId === nodeId;
      if (!isStartNode && rawNode.terminal === true) terminalCount += 1;
      if (
        rawNode.extractable !== undefined &&
        typeof rawNode.extractable !== "boolean"
      ) {
        issues.push({
          level: "error",
          path: `maps.${mapId}.nodes.${nodeId}.extractable`,
          message: "extractable 必须是布尔值。",
        });
      }
      if (isStartNode) {
        if (rawNode.terminal === true) {
          issues.push({
            level: "error",
            path: `maps.${mapId}.nodes.${nodeId}.terminal`,
            message: "起始入口不能同时作为固定终点。",
          });
        }
        if (rawNode.extractable === true) {
          issues.push({
            level: "error",
            path: `maps.${mapId}.nodes.${nodeId}.extractable`,
            message: "起始入口不能配置为撤离点。",
          });
        }
        if (rawNode.firstExtractionRewards !== undefined) {
          issues.push({
            level: "error",
            path: `maps.${mapId}.nodes.${nodeId}.firstExtractionRewards`,
            message: "起始入口不能配置首次撤离奖励。",
          });
        }
        if (rawNode.loot !== undefined) {
          issues.push({
            level: "warning",
            path: `maps.${mapId}.nodes.${nodeId}.loot`,
            message: "起始节点不会产生战利品，这份掉落配置会被忽略。",
          });
        }
        if (Array.isArray(rawNode.eventPoolIds) && rawNode.eventPoolIds.length) {
          issues.push({
            level: "warning",
            path: `maps.${mapId}.nodes.${nodeId}.eventPoolIds`,
            message: "起始节点不会抽取随机事件，这些事件池会被忽略。",
          });
        }
      } else {
        if (
          rawNode.firstExtractionRewards !== undefined &&
          rawNode.terminal !== true &&
          rawNode.extractable !== true
        ) {
          issues.push({
            level: "error",
            path: `maps.${mapId}.nodes.${nodeId}.firstExtractionRewards`,
            message: "只有撤离点或固定终点可以配置首次撤离奖励。",
          });
        }
        checkInventoryReferences(
          rawNode.firstExtractionRewards,
          `maps.${mapId}.nodes.${nodeId}.firstExtractionRewards`,
          itemIds,
          issues,
        );
        if (isRecord(rawNode.firstExtractionRewards)) {
          for (const [itemId, quantity] of Object.entries(
            rawNode.firstExtractionRewards,
          )) {
            if (quantity !== 1) {
              issues.push({
                level: "error",
                path: `maps.${mapId}.nodes.${nodeId}.firstExtractionRewards.${itemId}`,
                message: "首次撤离奖励的每种物品数量必须恰好为 1。",
              });
            }
          }
        }
        checkNodeLoot(
          rawNode.loot,
          `maps.${mapId}.nodes.${nodeId}.loot`,
          items,
          issues,
        );
        const nodePools = rawNode.eventPoolIds;
        if (nodePools !== undefined && !Array.isArray(nodePools)) {
          issues.push({
            level: "error",
            path: `maps.${mapId}.nodes.${nodeId}.eventPoolIds`,
            message: "节点事件池必须是事件池 ID 数组，省略或留空表示无事件。",
          });
        } else if (Array.isArray(nodePools)) {
          const seenPoolIds = new Set<string>();
          for (const poolId of nodePools) {
            if (typeof poolId !== "string" || !poolIds.has(poolId)) {
              issues.push({
                level: "error",
                path: `maps.${mapId}.nodes.${nodeId}.eventPoolIds`,
                message: `引用了不存在的事件池 ${String(poolId)}。`,
              });
            } else if (seenPoolIds.has(poolId)) {
              issues.push({
                level: "error",
                path: `maps.${mapId}.nodes.${nodeId}.eventPoolIds`,
                message: `事件池 ${poolId} 重复。`,
              });
            } else {
              seenPoolIds.add(poolId);
            }
          }
        }
      }
      const edges = Array.isArray(rawNode.edges) ? rawNode.edges : [];
      const targets: string[] = [];
      const edgeIds = new Set<string>();
      for (const [edgeIndex, rawEdge] of edges.entries()) {
        if (!isRecord(rawEdge) || typeof rawEdge.toNodeId !== "string") {
          issues.push({
            level: "error",
            path: `maps.${mapId}.nodes.${nodeId}.edges.${edgeIndex}`,
            message: "路线缺少有效的目标节点。",
          });
          continue;
        }
        targets.push(rawEdge.toNodeId);
        if (!Object.hasOwn(nodes, rawEdge.toNodeId)) {
          issues.push({
            level: "error",
            path: `maps.${mapId}.nodes.${nodeId}.edges.${edgeIndex}.toNodeId`,
            message: `目标节点 ${rawEdge.toNodeId} 不存在。`,
          });
        }
        const edgePath = `maps.${mapId}.nodes.${nodeId}.edges.${edgeIndex}`;
        if (typeof rawEdge.id !== "string" || !rawEdge.id.trim()) {
          issues.push({
            level: "error",
            path: `${edgePath}.id`,
            message: "路线必须配置非空 ID。",
          });
        } else if (edgeIds.has(rawEdge.id)) {
          issues.push({
            level: "error",
            path: `${edgePath}.id`,
            message: `路线 ID ${rawEdge.id} 重复。`,
          });
        } else {
          edgeIds.add(rawEdge.id);
        }
        if (
          rawEdge.hidden !== undefined &&
          typeof rawEdge.hidden !== "boolean"
        ) {
          issues.push({
            level: "error",
            path: `${edgePath}.hidden`,
            message: "hidden 必须是布尔值。",
          });
        }
        if (rawEdge.requirement !== undefined && !isRecord(rawEdge.requirement)) {
          issues.push({
            level: "error",
            path: `${edgePath}.requirement`,
            message: "路线条件必须是对象。",
          });
        } else if (isRecord(rawEdge.requirement)) {
          const tagId = rawEdge.requirement.tagId;
          if (
            tagId !== undefined &&
            (typeof tagId !== "string" || !tagIds.has(tagId))
          ) {
            issues.push({
              level: "error",
              path: `${edgePath}.requirement.tagId`,
              message: `引用了不存在的 Tag ${String(tagId)}。`,
            });
          }
          if (tagId !== undefined && rawEdge.hidden !== true) {
            issues.push({
              level: "error",
              path: `${edgePath}.requirement.tagId`,
              message: "普通路线不能配置 Tag 门槛；Tag 只用于触发隐藏路线。",
            });
          }
          checkSecondaryRequirement(
            rawEdge.requirement.secondary,
            `${edgePath}.requirement.secondary`,
            issues,
          );
          if (rawEdge.requirement.minimumStat !== undefined) {
            if (!isRecord(rawEdge.requirement.minimumStat)) {
              issues.push({
                level: "error",
                path: `${edgePath}.requirement.minimumStat`,
                message: "主属性门槛必须是属性到数值的对象。",
              });
            } else {
              for (const [stat, value] of Object.entries(
                rawEdge.requirement.minimumStat,
              )) {
                if (!(["fitness", "perception", "technique"] as string[]).includes(stat)) {
                  issues.push({
                    level: "error",
                    path: `${edgePath}.requirement.minimumStat.${stat}`,
                    message: `未知主属性 ${stat}。`,
                  });
                } else if (
                  typeof value !== "number" ||
                  !Number.isInteger(value) ||
                  value < 1
                ) {
                  issues.push({
                    level: "error",
                    path: `${edgePath}.requirement.minimumStat.${stat}`,
                    message: "主属性门槛必须是不小于 1 的整数。",
                  });
                }
              }
            }
          }
        }
        if (
          rawEdge.hidden === true &&
          (!isRecord(rawEdge.requirement) ||
            typeof rawEdge.requirement.tagId !== "string" ||
            !tagIds.has(rawEdge.requirement.tagId))
        ) {
          issues.push({
            level: "error",
            path: `${edgePath}.hidden`,
            message: "隐藏路线必须配置一个有效的 Tag 条件。",
          });
        }
      }
      adjacency.set(nodeId, targets);
    }
    if (!terminalCount) {
      issues.push({
        level: "error",
        path: `maps.${mapId}.nodes`,
        message: "地图至少需要一个固定终点。",
      });
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visiting.add(nodeId);
      for (const target of adjacency.get(nodeId) ?? []) {
        if (hasCycle(target)) return true;
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };
    if ([...adjacency.keys()].some(hasCycle)) {
      issues.push({
        level: "error",
        path: `maps.${mapId}.nodes`,
        message: "地图路线必须是无循环分叉图。",
      });
    }
  }

  const taskPrerequisites = new Map<string, string[]>();
  for (const [taskId, rawTask] of Object.entries(tasks)) {
    if (!isRecord(rawTask)) continue;
    const requirement = isRecord(rawTask.requirement) ? rawTask.requirement : {};
    const reward = isRecord(rawTask.reward) ? rawTask.reward : {};
    if (!isRecord(rawTask.requirement)) {
      issues.push({
        level: "error",
        path: `tasks.${taskId}.requirement`,
        message: "任务条件必须是对象。",
      });
    }
    if (!isRecord(rawTask.reward)) {
      issues.push({
        level: "error",
        path: `tasks.${taskId}.reward`,
        message: "任务奖励必须是对象。",
      });
    }
    for (const key of Object.keys(requirement)) {
      if (!["items", "currency", "goals"].includes(key)) {
        issues.push({
          level: "error",
          path: `tasks.${taskId}.requirement.${key}`,
          message: "未知的任务条件字段。",
        });
      }
    }
    for (const key of Object.keys(reward)) {
      if (
        ![
          "currency",
          "items",
          "unlockMapIds",
          "addPetIds",
          "warehouseSlots",
        ].includes(key)
      ) {
        issues.push({
          level: "error",
          path: `tasks.${taskId}.reward.${key}`,
          message: key === "xp" ? "任务不能奖励经验值。" : "未知的任务奖励字段。",
        });
      }
    }
    checkInventoryReferences(
      requirement.items,
      `tasks.${taskId}.requirement.items`,
      itemIds,
      issues,
    );
    checkInventoryReferences(
      reward.items,
      `tasks.${taskId}.reward.items`,
      itemIds,
      issues,
    );
    if (
      requirement.currency !== undefined &&
      (typeof requirement.currency !== "number" ||
        !Number.isInteger(requirement.currency) ||
        requirement.currency < 1)
    ) {
      issues.push({
        level: "error",
        path: `tasks.${taskId}.requirement.currency`,
        message: "提交货币必须是不小于 1 的整数。",
      });
    }
    if (
      reward.currency !== undefined &&
      (typeof reward.currency !== "number" ||
        !Number.isInteger(reward.currency) ||
        reward.currency < 1)
    ) {
      issues.push({
        level: "error",
        path: `tasks.${taskId}.reward.currency`,
        message: "奖励货币必须是不小于 1 的整数。",
      });
    }
    if (
      reward.warehouseSlots !== undefined &&
      (typeof reward.warehouseSlots !== "number" ||
        !Number.isInteger(reward.warehouseSlots) ||
        reward.warehouseSlots < 1)
    ) {
      issues.push({
        level: "error",
        path: `tasks.${taskId}.reward.warehouseSlots`,
        message: "仓库扩容格数必须是不小于 1 的整数。",
      });
    }

    const goals = requirement.goals;
    if (goals !== undefined && !Array.isArray(goals)) {
      issues.push({
        level: "error",
        path: `tasks.${taskId}.requirement.goals`,
        message: "任务目标必须是数组。",
      });
    } else if (Array.isArray(goals)) {
      const seenGoals = new Set<string>();
      for (const [index, goal] of goals.entries()) {
        const path = `tasks.${taskId}.requirement.goals.${index}`;
        if (!isRecord(goal)) {
          issues.push({
            level: "error",
            path,
            message: "任务目标必须是对象。",
          });
          continue;
        }
        if (goal.type === "clear-map") {
          if (typeof goal.mapId !== "string" || !mapIds.has(goal.mapId)) {
            issues.push({
              level: "error",
              path: `${path}.mapId`,
              message: `引用了不存在的地图 ${String(goal.mapId)}。`,
            });
            continue;
          }
          const key = `clear-map:${goal.mapId}`;
          if (seenGoals.has(key)) {
            issues.push({
              level: "error",
              path,
              message: `首次通关地图 ${goal.mapId} 的目标重复。`,
            });
          }
          seenGoals.add(key);
          continue;
        }
        if (goal.type === "milestone") {
          if (!isPlayerMilestoneId(goal.milestoneId)) {
            issues.push({
              level: "error",
              path: `${path}.milestoneId`,
              message: `引用了不存在的玩家里程碑 ${String(goal.milestoneId)}。`,
            });
            continue;
          }
          const key = `milestone:${goal.milestoneId}`;
          if (seenGoals.has(key)) {
            issues.push({
              level: "error",
              path,
              message: `玩家里程碑 ${goal.milestoneId} 的目标重复。`,
            });
          }
          seenGoals.add(key);
          continue;
        }
        issues.push({
          level: "error",
          path: `${path}.type`,
          message: "任务目标只支持 clear-map 或 milestone。",
        });
      }
    }

    if (
      !Object.keys(isRecord(requirement.items) ? requirement.items : {}).length &&
      requirement.currency === undefined &&
      (!Array.isArray(goals) || !goals.length)
    ) {
      issues.push({
        level: "error",
        path: `tasks.${taskId}.requirement`,
        message: "任务至少需要一项物品、货币或目标条件。",
      });
    }
    if (
      !Object.keys(isRecord(reward.items) ? reward.items : {}).length &&
      reward.currency === undefined &&
      reward.warehouseSlots === undefined &&
      (!Array.isArray(reward.unlockMapIds) || !reward.unlockMapIds.length) &&
      (!Array.isArray(reward.addPetIds) || !reward.addPetIds.length)
    ) {
      issues.push({
        level: "error",
        path: `tasks.${taskId}.reward`,
        message: "任务至少需要配置一项奖励。",
      });
    }

    const rawPrerequisites = rawTask.prerequisiteTaskIds;
    const prerequisites: string[] = [];
    if (rawPrerequisites !== undefined && !Array.isArray(rawPrerequisites)) {
      issues.push({
        level: "error",
        path: `tasks.${taskId}.prerequisiteTaskIds`,
        message: "前置任务必须是任务 ID 数组。",
      });
    } else if (Array.isArray(rawPrerequisites)) {
      const seen = new Set<string>();
      for (const [index, prerequisiteId] of rawPrerequisites.entries()) {
        const path = `tasks.${taskId}.prerequisiteTaskIds.${index}`;
        if (typeof prerequisiteId !== "string" || !Object.hasOwn(tasks, prerequisiteId)) {
          issues.push({
            level: "error",
            path,
            message: `引用了不存在的前置任务 ${String(prerequisiteId)}。`,
          });
        } else if (prerequisiteId === taskId) {
          issues.push({ level: "error", path, message: "任务不能把自己设为前置任务。" });
        } else if (seen.has(prerequisiteId)) {
          issues.push({ level: "error", path, message: `前置任务 ${prerequisiteId} 重复。` });
        } else {
          seen.add(prerequisiteId);
          prerequisites.push(prerequisiteId);
        }
      }
    }
    taskPrerequisites.set(taskId, prerequisites);

    if (reward.unlockMapIds !== undefined && !Array.isArray(reward.unlockMapIds)) {
      issues.push({
        level: "error",
        path: `tasks.${taskId}.reward.unlockMapIds`,
        message: "解锁地图必须是地图 ID 数组。",
      });
    }
    for (const mapId of Array.isArray(reward.unlockMapIds)
      ? reward.unlockMapIds
      : []) {
      if (typeof mapId !== "string" || !mapIds.has(mapId)) {
        issues.push({
          level: "error",
          path: `tasks.${taskId}.reward.unlockMapIds`,
          message: `引用了不存在的地图 ${String(mapId)}。`,
        });
      }
    }
    if (reward.addPetIds !== undefined && !Array.isArray(reward.addPetIds)) {
      issues.push({
        level: "error",
        path: `tasks.${taskId}.reward.addPetIds`,
        message: "解锁宠物必须是宠物模板 ID 数组。",
      });
    }
    for (const petId of Array.isArray(reward.addPetIds)
      ? reward.addPetIds
      : []) {
      if (typeof petId !== "string" || !petIds.has(petId)) {
        issues.push({
          level: "error",
          path: `tasks.${taskId}.reward.addPetIds`,
          message: `引用了不存在的宠物模板 ${String(petId)}。`,
        });
      }
    }
  }

  const taskVisiting = new Set<string>();
  const taskVisited = new Set<string>();
  const hasTaskCycle = (taskId: string): boolean => {
    if (taskVisiting.has(taskId)) return true;
    if (taskVisited.has(taskId)) return false;
    taskVisiting.add(taskId);
    for (const prerequisiteId of taskPrerequisites.get(taskId) ?? []) {
      if (hasTaskCycle(prerequisiteId)) return true;
    }
    taskVisiting.delete(taskId);
    taskVisited.add(taskId);
    return false;
  };
  if ([...taskPrerequisites.keys()].some(hasTaskCycle)) {
    issues.push({
      level: "error",
      path: "tasks",
      message: "前置任务关系不能形成循环依赖。",
    });
  }

  for (const [petId, rawPet] of Object.entries(petTemplates)) {
    if (!isRecord(rawPet)) continue;
    if (rawPet.injury === "critical") {
      issues.push({
        level: "warning",
        path: `petTemplates.${petId}.injury`,
        message: "critical 是旧伤势，运行时会并入 injured；请改用 healthy / injured / incapacitated。",
      });
    } else if (
      rawPet.injury !== "healthy" &&
      rawPet.injury !== "injured" &&
      rawPet.injury !== "incapacitated"
    ) {
      issues.push({
        level: "error",
        path: `petTemplates.${petId}.injury`,
        message: "伤势必须是 healthy / injured / incapacitated 之一。",
      });
    }
    // 每只宠物都必须拥有全部四项次要属性——它们不是某些宠物独有的，
    // 缺项会让门禁判定读到 0，看起来像「这只宠物特别差」而不是「配漏了」。
    const secondary = rawPet.secondaryStats;
    if (!isRecord(secondary)) {
      issues.push({
        level: "error",
        path: `petTemplates.${petId}.secondaryStats`,
        message: `必须配置全部四项次要属性（${SECONDARY_STAT_KEYS.join(" / ")}）。`,
      });
      continue;
    }
    for (const key of SECONDARY_STAT_KEYS) {
      const value = secondary[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        issues.push({
          level: "error",
          path: `petTemplates.${petId}.secondaryStats.${key}`,
          message: "次要属性初始值必须是非负整数。",
        });
      } else if (value > secondaryStatCap()) {
        issues.push({
          level: "error",
          path: `petTemplates.${petId}.secondaryStats.${key}`,
          message: `初始值 ${value} 超过上限 ${secondaryStatCap()}。`,
        });
      }
    }
  }

  return issues;
}

function readCatalog(key: string): Catalog | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (validateCatalog(parsed).some((issue) => issue.level === "error")) {
      return undefined;
    }
    return cloneCatalog(parsed as Catalog);
  } catch {
    return undefined;
  }
}

// FNV-1a：只用来判断"内容变没变"，不做安全用途。
export function fingerprintCatalog(value: Catalog): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export type CatalogSource = "draft" | "published" | "bundled";

export interface LoadedCatalog {
  catalog: Catalog;
  source: CatalogSource;
  // 本地存的这份是基于哪一版内置目录做的；和当前代码对不上说明代码更新了。
  bundledChanged: boolean;
}

function writeBaseline(): void {
  localStorage.setItem(BASELINE_KEY, fingerprintCatalog(bundledCatalog));
}

export function initializeCatalog(): Catalog {
  const published = readCatalog(PUBLISHED_KEY);
  const next = published ?? cloneCatalog(bundledCatalog);
  setCatalog(next);
  return next;
}

export function loadCatalogDraft(): LoadedCatalog {
  const draft = readCatalog(DRAFT_KEY);
  const published = readCatalog(PUBLISHED_KEY);
  const local = draft ?? published;
  // 没有记过基线的旧数据一律当成"内置已更新"，提醒一次总比一直瞒着好。
  const baseline = localStorage.getItem(BASELINE_KEY);
  return {
    catalog: local ?? cloneCatalog(bundledCatalog),
    source: draft ? "draft" : published ? "published" : "bundled",
    bundledChanged: Boolean(local) && baseline !== fingerprintCatalog(bundledCatalog),
  };
}

export function saveCatalogDraft(next: Catalog): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(cloneCatalog(next)));
  writeBaseline();
}

export function publishCatalog(next: Catalog): CatalogIssue[] {
  next = cloneCatalog(next);
  const issues = validateCatalog(next);
  if (issues.some((issue) => issue.level === "error")) return issues;
  localStorage.setItem(PUBLISHED_KEY, JSON.stringify(next));
  localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  writeBaseline();
  setCatalog(cloneCatalog(next));
  return issues;
}

// 用户选择"继续用草稿"：记下当前内置指纹，不再重复提示。
export function acknowledgeBundledUpdate(): void {
  writeBaseline();
}

export interface CatalogDiffEntry {
  category: CatalogCategory;
  added: string[];
  removed: string[];
  changed: string[];
}

// 两份完整目录之间的记录级差异。只返回有变化的分类。
export function diffCatalog(baseCatalog: Catalog, nextCatalog: Catalog): CatalogDiffEntry[] {
  const entries: CatalogDiffEntry[] = [];
  for (const category of Object.keys(baseCatalog) as CatalogCategory[]) {
    const base = baseCatalog[category] as Record<string, unknown>;
    const mine = (nextCatalog[category] ?? {}) as Record<string, unknown>;
    const added = Object.keys(mine).filter((id) => !(id in base)).sort();
    const removed = Object.keys(base).filter((id) => !(id in mine)).sort();
    const changed = Object.keys(mine).filter(
      (id) => id in base && JSON.stringify(mine[id]) !== JSON.stringify(base[id]),
    ).sort();
    if (added.length || removed.length || changed.length) {
      entries.push({ category, added, removed, changed });
    }
  }
  return entries;
}

// 本地这份相对代码内置差在哪。
export function diffAgainstBundled(local: Catalog): CatalogDiffEntry[] {
  return diffCatalog(bundledCatalog, local);
}

export function clearLocalCatalogOverrides(): void {
  localStorage.removeItem(DRAFT_KEY);
  localStorage.removeItem(PUBLISHED_KEY);
  localStorage.removeItem(BASELINE_KEY);
}

export function resetCatalogDraft(): Catalog {
  const next = cloneCatalog(bundledCatalog);
  saveCatalogDraft(next);
  return next;
}

export function clearPublishedCatalog(): void {
  localStorage.removeItem(PUBLISHED_KEY);
  setCatalog(cloneCatalog(bundledCatalog));
}
