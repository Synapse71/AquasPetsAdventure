import { describe, expect, it } from "vitest";
import { bundledCatalog } from "../domain/catalog";
import type { Catalog } from "../domain/types";
import { diffCatalog, validateCatalog } from "./catalogStore";

function catalogWithEventFixture(): Catalog {
  const next = structuredClone(bundledCatalog);
  next.events["event-vent"] = {
    id: "event-vent",
    title: "测试事件",
    description: "配置校验专用夹具。",
    choices: [
      {
        id: "inspect",
        label: "检查",
        description: "测试选项。",
        stat: "perception",
        difficulty: 1,
        rewards: {},
      },
    ],
  };
  next.eventPools["pool-shelves"] = {
    id: "pool-shelves",
    eventIds: ["event-vent"],
  };
  return next;
}

describe("catalog validation", () => {
  it("accepts the bundled catalog", () => {
    expect(validateCatalog(bundledCatalog)).toEqual([]);
  });

  it("rejects invalid per-map node XP values", () => {
    const broken = structuredClone(bundledCatalog);
    broken.maps["map-1"].nodeXp = -1;
    broken.maps["map-2"].nodeXp = 1.5;

    const paths = validateCatalog(broken).map((issue) => issue.path);
    expect(paths).toContain("maps.map-1.nodeXp");
    expect(paths).toContain("maps.map-2.nodeXp");
  });

  it("rejects unknown root sections before publishing", () => {
    const broken = {
      ...structuredClone(bundledCatalog),
      accidentalSection: {},
    };
    expect(validateCatalog(broken)).toContainEqual({
      level: "error",
      path: "accidentalSection",
      message: "配置根节点包含未知分类。",
    });
  });

  it("detects broken references and cyclic maps", () => {
    const broken = catalogWithEventFixture();
    broken.eventPools["pool-shelves"].eventIds = ["missing-event"];
    broken.maps["map-1"].nodes["m1-goal-1"].terminal = false;
    broken.maps["map-1"].nodes["m1-goal-1"].edges = [
      {
        id: "cycle",
        label: "循环",
        description: "",
        toNodeId: "m1-point-1",
        durationMs: 1,
      },
    ];

    const messages = validateCatalog(broken).map((issue) => issue.message);
    expect(messages).toContain("引用了不存在的事件 missing-event。");
    expect(messages).toContain("地图至少需要一个固定终点。");
    expect(messages).toContain("地图路线必须是无循环分叉图。");
  });

  it("validates event fields and duplicate event pool members", () => {
    const broken = catalogWithEventFixture();
    const event = broken.events["event-vent"];
    event.title = "";
    event.choices.push(structuredClone(event.choices[0]));
    (event.choices[0] as { stat: unknown }).stat = "luck";
    (event.choices[0] as { difficulty: unknown }).difficulty = 1.5;
    delete (event.choices[0] as { rewards?: unknown }).rewards;
    broken.eventPools["pool-shelves"].eventIds = [
      "event-vent",
      "event-vent",
    ];

    const issues = validateCatalog(broken);
    const paths = issues.map((issue) => issue.path);
    expect(paths).toContain("events.event-vent.title");
    expect(paths).toContain("events.event-vent.choices.0.stat");
    expect(paths).toContain("events.event-vent.choices.0.difficulty");
    expect(paths).toContain("events.event-vent.choices.0.rewards");
    expect(paths).toContain("events.event-vent.choices.1.id");
    expect(
      issues.some((issue) => issue.message.includes("同一个事件池中重复")),
    ).toBe(true);
  });

  it("accepts secondary and leave event choices", () => {
    const catalog = catalogWithEventFixture();
    catalog.events["event-vent"].choices = [
      {
        id: "read-mark",
        label: "辨认暗记",
        description: "依靠学识判断。",
        resolution: {
          type: "secondary",
          stat: "lore",
          successThreshold: 3,
          extraSuccessThreshold: 5,
        },
        rewards: { paper: 1 },
        bonusRewards: { screw: 1 },
      },
      {
        id: "leave",
        label: "默默离开",
        description: "不介入事件。",
        resolution: { type: "leave" },
        rewards: {},
      },
    ];

    expect(
      validateCatalog(catalog).filter((issue) =>
        issue.path.startsWith("events.event-vent.choices"),
      ),
    ).toEqual([]);
  });

  it("rejects invalid secondary thresholds and rewards on leave choices", () => {
    const catalog = catalogWithEventFixture();
    catalog.events["event-vent"].choices = [
      {
        id: "read-mark",
        label: "辨认暗记",
        description: "门槛配置错误。",
        resolution: {
          type: "secondary",
          stat: "lore",
          successThreshold: 3,
          extraSuccessThreshold: 3,
        },
        rewards: {},
      },
      {
        id: "leave",
        label: "默默离开",
        description: "离开不应带走奖励。",
        resolution: { type: "leave" },
        rewards: { paper: 1 },
      },
    ];

    const issues = validateCatalog(catalog);
    expect(issues).toContainEqual({
      level: "error",
      path:
        "events.event-vent.choices.0.resolution.extraSuccessThreshold",
      message: "大成功门槛必须高于成功门槛。",
    });
    expect(issues).toContainEqual({
      level: "error",
      path: "events.event-vent.choices.1.rewards",
      message: "直接离开不能配置事件奖励。",
    });
  });

  it("rejects items with a missing or unknown rarity", () => {
    const broken = structuredClone(bundledCatalog);
    delete (broken.items.paper as { rarity?: unknown }).rarity;
    (broken.items.hammer as { rarity: unknown }).rarity = "白";

    const issues = validateCatalog(broken);
    const paths = issues.map((issue) => issue.path);
    expect(paths).toContain("items.paper.rarity");
    expect(paths).toContain("items.hammer.rarity");
    expect(
      issues.every((issue) => issue.level === "error"),
    ).toBe(true);
  });

  it("校验事件优势骰 Tag，并兼容提醒旧幸运字段", () => {
    const invalid = structuredClone(bundledCatalog);
    (invalid.tags["tag-lucky"] as { eventRollAdvantage: unknown })
      .eventRollAdvantage = "yes";
    expect(validateCatalog(invalid)).toContainEqual({
      level: "error",
      path: "tags.tag-lucky.eventRollAdvantage",
      message: "事件优势骰开关必须是布尔值。",
    });

    const legacy = structuredClone(bundledCatalog);
    delete legacy.tags["tag-lucky"].eventRollAdvantage;
    (legacy.tags["tag-lucky"] as { extraRewardChance?: number })
      .extraRewardChance = 0.2;
    expect(validateCatalog(legacy)).toContainEqual({
      level: "warning",
      path: "tags.tag-lucky.extraRewardChance",
      message:
        "extraRewardChance 是旧字段，运行时会按一次、不叠加的事件优势骰处理；请改用 eventRollAdvantage。",
    });
  });

  it("validates the node's single loot mode, filters, and composition count", () => {
    const missing = structuredClone(bundledCatalog);
    delete (missing.maps["map-1"].nodes["m1-point-1"] as { loot?: unknown })
      .loot;
    expect(validateCatalog(missing).map((issue) => issue.path)).toContain(
      "maps.map-1.nodes.m1-point-1.loot",
    );

    const overlap = structuredClone(bundledCatalog);
    overlap.maps["map-1"].nodes["m1-point-1"].loot = {
      mode: "independent",
      minCount: 3,
      maxCount: 3,
      rarityWeights: { common: 1 },
      whitelistItemIds: ["paper"],
      blacklistItemIds: ["paper"],
    };
    expect(
      validateCatalog(overlap).some((issue) =>
        issue.message.includes("不能同时出现在白名单和黑名单"),
      ),
    ).toBe(true);

    const outOfRange = structuredClone(bundledCatalog);
    outOfRange.maps["map-1"].nodes["m1-point-1"].loot = {
      mode: "composition",
      minCount: 3,
      maxCount: 5,
      whitelistItemIds: ["paper"],
      compositions: [
        {
          id: "too-many",
          weight: 1,
          rarityCounts: { common: 6 },
        },
      ],
    };
    expect(
      validateCatalog(outOfRange).some((issue) =>
        issue.message.includes("组合总数 6 不在 3～5 范围内"),
      ),
    ).toBe(true);
  });

  it("validates item Tag loot filters", () => {
    const valid = structuredClone(bundledCatalog);
    valid.maps["map-1"].nodes["m1-point-1"].loot = {
      mode: "independent",
      minCount: 3,
      maxCount: 3,
      rarityWeights: { common: 1 },
      whitelistItemTags: ["material"],
      blacklistItemIds: ["paper"],
    };
    expect(
      validateCatalog(valid).filter((issue) =>
        issue.path.startsWith("maps.map-1.nodes.m1-point-1.loot"),
      ),
    ).toEqual([]);

    const overlap = structuredClone(valid);
    overlap.maps["map-1"].nodes["m1-point-1"].loot = {
      ...overlap.maps["map-1"].nodes["m1-point-1"].loot!,
      blacklistItemTags: ["material"],
    };
    expect(
      validateCatalog(overlap).some((issue) =>
        issue.message.includes(
          "物品 Tag material 不能同时出现在白名单和黑名单",
        ),
      ),
    ).toBe(true);

    const missing = structuredClone(valid);
    missing.maps["map-1"].nodes["m1-point-1"].loot = {
      ...missing.maps["map-1"].nodes["m1-point-1"].loot!,
      whitelistItemTags: ["missing-item-tag"],
    };
    expect(validateCatalog(missing).map((issue) => issue.path)).toContain(
      "maps.map-1.nodes.m1-point-1.loot.whitelistItemTags.0",
    );
  });

  it("allows exploration nodes without random events", () => {
    const withoutEvents = structuredClone(bundledCatalog);
    withoutEvents.maps["map-1"].nodes["m1-point-1"].eventPoolIds = [];
    expect(
      validateCatalog(withoutEvents).filter((issue) =>
        issue.path.startsWith(
          "maps.map-1.nodes.m1-point-1.eventPoolIds",
        ),
      ),
    ).toEqual([]);

    const duplicatePool = catalogWithEventFixture();
    duplicatePool.maps["map-1"].nodes["m1-point-1"].eventPoolIds = [
      "pool-shelves",
      "pool-shelves",
    ];
    expect(
      validateCatalog(duplicatePool).some((issue) =>
        issue.message.includes("事件池 pool-shelves 重复"),
      ),
    ).toBe(true);
  });

  it("validates node-level first extraction rewards", () => {
    const valid = structuredClone(bundledCatalog);
    valid.maps["map-1"].nodes["m1-point-1"].extractable = true;
    valid.maps["map-1"].nodes["m1-point-1"].firstExtractionRewards = {
      paper: 1,
    };
    expect(
      validateCatalog(valid).filter((issue) =>
        issue.path.includes("firstExtractionRewards"),
      ),
    ).toEqual([]);

    const broken = structuredClone(valid);
    broken.maps["map-1"].nodes["m1-point-1"].firstExtractionRewards = {
      "missing-prize": 1,
      paper: 0,
    };
    const paths = validateCatalog(broken).map((issue) => issue.path);
    expect(paths).toContain(
      "maps.map-1.nodes.m1-point-1.firstExtractionRewards.missing-prize",
    );
    expect(paths).toContain(
      "maps.map-1.nodes.m1-point-1.firstExtractionRewards.paper",
    );

    const tooMany = structuredClone(valid);
    tooMany.maps["map-1"].nodes["m1-point-1"].firstExtractionRewards = {
      paper: 2,
    };
    expect(validateCatalog(tooMany).map((issue) => issue.path)).toContain(
      "maps.map-1.nodes.m1-point-1.firstExtractionRewards.paper",
    );

    const ordinaryNodeReward = structuredClone(valid);
    ordinaryNodeReward.maps["map-1"].nodes["m1-point-2"].firstExtractionRewards = {
      paper: 1,
    };
    expect(
      validateCatalog(ordinaryNodeReward).some((issue) =>
        issue.message.includes("只有撤离点或固定终点"),
      ),
    ).toBe(true);
  });

  it("校验地图情报阈值，以及普通路线不能使用 Tag 门槛", () => {
    const broken = structuredClone(bundledCatalog);
    broken.maps["map-1"].informationThresholds = { partial: 4, full: 4 };
    broken.maps["map-1"].nodes["m1-start"].edges[0].requirement = {
      tagId: "tag-lucky",
    };
    const issues = validateCatalog(broken);
    expect(issues.map((issue) => issue.path)).toContain(
      "maps.map-1.informationThresholds.full",
    );
    expect(issues.some((issue) => issue.message.includes("普通路线不能配置 Tag"))).toBe(true);
  });

  it("可出售必须是显式字段，不能靠 sellValue 有无表达", () => {
    // 不变量 14：漏填价格和刻意设为不可卖，在数据上必须分得出来。
    const missing = structuredClone(bundledCatalog);
    delete (missing.items.paper as { sellable?: boolean }).sellable;
    expect(validateCatalog(missing).map((i) => i.path)).toContain(
      "items.paper.sellable",
    );

    // 说了可卖却没价格 → 报错，而不是静默变成不可卖。
    const noPrice = structuredClone(bundledCatalog);
    delete (noPrice.items.paper as { sellValue?: number }).sellValue;
    expect(validateCatalog(noPrice).map((i) => i.path)).toContain(
      "items.paper.sellValue",
    );

    // 说了不可卖却留着价格 → 同样报错，避免出现说不清的记录。
    const contradictory = structuredClone(bundledCatalog);
    contradictory.items.paper.sellable = false;
    expect(validateCatalog(contradictory).map((i) => i.path)).toContain(
      "items.paper.sellValue",
    );

    // 干净的不可出售物品：只要价格字段也清掉就合法。
    const clean = structuredClone(bundledCatalog);
    clean.items.paper.sellable = false;
    delete (clean.items.paper as { sellValue?: number }).sellValue;
    expect(
      validateCatalog(clean).filter((i) => i.path.startsWith("items.paper")),
    ).toEqual([]);
  });

  it("宠物模板必须配齐四项次要属性", () => {
    const missing = structuredClone(bundledCatalog);
    delete (missing.petTemplates.gugugaga as { secondaryStats?: unknown })
      .secondaryStats;
    expect(validateCatalog(missing).map((i) => i.path)).toContain(
      "petTemplates.gugugaga.secondaryStats",
    );

    const partial = structuredClone(bundledCatalog);
    delete (partial.petTemplates.gugugaga.secondaryStats as { guile?: number })
      .guile;
    expect(validateCatalog(partial).map((i) => i.path)).toContain(
      "petTemplates.gugugaga.secondaryStats.guile",
    );

    const overCap = structuredClone(bundledCatalog);
    partial.petTemplates.gugugaga.secondaryStats.guile = 0;
    overCap.petTemplates.gugugaga.secondaryStats.lore = 999;
    expect(
      validateCatalog(overCap).some((i) => i.message.includes("超过上限")),
    ).toBe(true);
  });

  it("成长道具的加成必须是显式且合法的字段", () => {
    const badStat = structuredClone(bundledCatalog);
    (badStat.items.telescope as { secondaryGrant: unknown }).secondaryGrant = {
      stat: "武力",
      amount: 1,
    };
    expect(validateCatalog(badStat).map((i) => i.path)).toContain(
      "items.telescope.secondaryGrant.stat",
    );

    const badAmount = structuredClone(bundledCatalog);
    badStat.items.telescope.secondaryGrant = { stat: "lore", amount: 1 };
    (badAmount.items.telescope as { secondaryGrant: unknown }).secondaryGrant = {
      stat: "lore",
      amount: 0,
    };
    expect(validateCatalog(badAmount).map((i) => i.path)).toContain(
      "items.telescope.secondaryGrant.amount",
    );

    // 两类成长道具互斥：不能既给 Tag 又加次要属性。
    const both = structuredClone(bundledCatalog);
    both.items.telescope.secondaryGrant = { stat: "lore", amount: 1 };
    both.items.telescope.tagGrantId = "tag-lucky";
    expect(
      validateCatalog(both).some((i) =>
        i.message.includes("不能同时赋予 Tag 和提升次要属性"),
      ),
    ).toBe(true);
  });

  it("门禁必须是单项次要属性，且不能高到没人够得到", () => {
    const badShape = catalogWithEventFixture();
    (badShape.events["event-vent"] as { requiredSecondary: unknown })
      .requiredSecondary = { courage: 4 };
    expect(validateCatalog(badShape).map((i) => i.path)).toContain(
      "events.event-vent.requiredSecondary.stat",
    );

    const unreachable = catalogWithEventFixture();
    unreachable.events["event-vent"].requiredSecondary = {
      stat: "courage",
      value: 999,
    };
    const issue = validateCatalog(unreachable).find(
      (i) => i.path === "events.event-vent.requiredSecondary.value",
    );
    expect(issue?.level).toBe("warning");
    expect(issue?.message).toContain("任何宠物都无法达到");

    // 路线上的门禁走同一套校验。
    const badRoute = structuredClone(bundledCatalog);
    badRoute.maps["map-1"].nodes["m1-point-1"].edges[0].requirement = {
      secondary: { stat: "eloquence", value: 0 },
    };
    expect(
      validateCatalog(badRoute).some((i) =>
        i.path.endsWith("requirement.secondary.value"),
      ),
    ).toBe(true);
  });

  it("校验路线 Tag 条件和隐藏路线规则", () => {
    const missingTag = structuredClone(bundledCatalog);
    missingTag.maps["map-1"].nodes["m1-start"].edges[0].requirement = {
      tagId: "tag-missing",
    };
    expect(
      validateCatalog(missingTag).map((issue) => issue.path),
    ).toContain(
      "maps.map-1.nodes.m1-start.edges.0.requirement.tagId",
    );

    const hiddenWithoutTag = structuredClone(bundledCatalog);
    hiddenWithoutTag.maps["map-1"].nodes["m1-start"].edges[0].hidden = true;
    expect(
      validateCatalog(hiddenWithoutTag).some((issue) =>
        issue.message.includes("隐藏路线必须配置一个有效的 Tag 条件"),
      ),
    ).toBe(true);

    const valid = structuredClone(bundledCatalog);
    valid.maps["map-1"].nodes["m1-start"].edges[0].hidden = true;
    valid.maps["map-1"].nodes["m1-start"].edges[0].requirement = {
      tagId: "tag-lucky",
      secondary: { stat: "lore", value: 4 },
    };
    expect(
      validateCatalog(valid).filter((issue) =>
        issue.path.includes("maps.map-1.nodes.m1-start.edges.0"),
      ),
    ).toEqual([]);
  });

  it("校验任务货币、通关目标、经验奖励与前置任务循环", () => {
    const broken = structuredClone(bundledCatalog);
    broken.tasks["task-a"] = {
      id: "task-a",
      title: "任务 A",
      description: "",
      prerequisiteTaskIds: ["task-b"],
      requirement: {
        currency: 0,
        goals: [
          { type: "clear-map", mapId: "missing-map" },
          { type: "milestone", milestoneId: "missing-milestone" } as never,
        ],
      },
      reward: { xp: 10 } as never,
    };
    broken.tasks["task-b"] = {
      id: "task-b",
      title: "任务 B",
      description: "",
      prerequisiteTaskIds: ["task-a"],
      requirement: { items: { paper: 1 } },
      reward: { currency: 1 },
    };

    const issues = validateCatalog(broken);
    expect(issues.map((issue) => issue.path)).toContain(
      "tasks.task-a.requirement.currency",
    );
    expect(issues.map((issue) => issue.path)).toContain(
      "tasks.task-a.requirement.goals.0.mapId",
    );
    expect(issues.map((issue) => issue.path)).toContain(
      "tasks.task-a.requirement.goals.1.milestoneId",
    );
    expect(issues).toContainEqual({
      level: "error",
      path: "tasks.task-a.reward.xp",
      message: "任务不能奖励经验值。",
    });
    expect(issues.map((issue) => issue.message)).toContain(
      "前置任务关系不能形成循环依赖。",
    );

    const valid = structuredClone(bundledCatalog);
    valid.tasks["task-tutorial"] = {
      id: "task-tutorial",
      title: "新手准备",
      description: "",
      requirement: {
        goals: [
          { type: "milestone", milestoneId: "opened-pets" },
          { type: "milestone", milestoneId: "opened-inventory" },
        ],
      },
      reward: { currency: 1 },
    };
    expect(
      validateCatalog(valid).filter((issue) =>
        issue.path.startsWith("tasks.task-tutorial"),
      ),
    ).toEqual([]);
  });
});

describe("catalog change summary", () => {
  it("lists added, removed, and changed record IDs by category", () => {
    const next = structuredClone(bundledCatalog);
    next.items.paper.name = "改名后的纸张";
    next.items["test-added-item"] = {
      id: "test-added-item",
      name: "新增测试物品",
      rarity: "common",
      weight: 1,
      sellable: true,
      sellValue: 1,
    };
    delete next.items.hammer;

    const changes = diffCatalog(bundledCatalog, next);
    expect(changes.find((entry) => entry.category === "items")).toEqual({
      category: "items",
      added: ["test-added-item"],
      removed: ["hammer"],
      changed: ["paper"],
    });
  });
});

describe("食物效果的目录校验", () => {
  function withFood(patch: Record<string, unknown>): Catalog {
    const next = structuredClone(bundledCatalog);
    Object.assign(next.items.chocolate, patch);
    return next;
  }
  const errors = (c: Catalog) => validateCatalog(c).filter(i => i.level === "error").map(i => i.path);
  const warnings = (c: Catalog) => validateCatalog(c).filter(i => i.level === "warning").map(i => i.path);

  it("正常配置不报错", () => {
    const ok = withFood({ foodBuff: { stat: "fitness", amount: 2 }, foodHeal: { steps: 1 } });
    expect(errors(ok)).toEqual([]);
  });

  it("食物不能加次要属性——这是把「食物变成钥匙」堵死在配表层", () => {
    expect(errors(withFood({ foodBuff: { stat: "lore", amount: 1 } })))
      .toContain("items.chocolate.foodBuff.stat");
    expect(errors(withFood({ foodBuff: { stat: "eloquence", amount: 1 } })))
      .toContain("items.chocolate.foodBuff.stat");
  });

  it("加成必须是不小于 1 的整数", () => {
    for (const amount of [0, -1, 1.5, "2"]) {
      expect(errors(withFood({ foodBuff: { stat: "fitness", amount } })))
        .toContain("items.chocolate.foodBuff.amount");
    }
  });

  it("治疗档数只能是 1 或 2——伤势一共就三档", () => {
    for (const steps of [0, 3, 1.5]) {
      expect(errors(withFood({ foodHeal: { steps } })))
        .toContain("items.chocolate.foodHeal.steps");
    }
    expect(errors(withFood({ foodHeal: { steps: 2 } }))).toEqual([]);
  });

  it("不是对象的写法直接报错", () => {
    expect(errors(withFood({ foodBuff: 2 }))).toContain("items.chocolate.foodBuff");
    expect(errors(withFood({ foodHeal: "1" }))).toContain("items.chocolate.foodHeal");
  });

  it("配了效果却没打 food 标签是提醒，不是错误——能跑，但策划八成漏了", () => {
    const next = structuredClone(bundledCatalog);
    next.items.paper.foodBuff = { stat: "fitness", amount: 1 };
    expect(errors(next)).toEqual([]);
    expect(warnings(next)).toContain("items.paper.tags");
  });
});
