import { describe, expect, it } from "vitest";
import { createInitialState, startExpedition } from "../domain/engine";
import type { GameState } from "../domain/types";
import { drawGacha, gachaStatus } from "../domain/gacha";
import { addCurrency, arriveNow, fastForward, healResting, nextArrivalIn, resetGachaDay, restingInjuredCount } from "./gmActions";

const NOW = 1_700_000_000_000;

/** 走引擎真正的出发流程造一个「正在路上」的存档，手搓字段会让 tick 找不到目标节点。 */
function traveling(minutes: number, now = NOW): GameState {
  const initial = createInitialState();
  const state = startExpedition(initial, { mapId: "map-1", petIds: [Object.keys(initial.pets)[0]] }, now);
  const expedition = state.expeditions[0];
  return { ...state, expeditions: [{ ...expedition, startedAt: now, arriveAt: now + minutes * 60_000 }] };
}

describe("GM：立即抵达", () => {
  it("把行进中的 arriveAt 拨到当前时刻，tick 之后不再处于行进状态", () => {
    const next = arriveNow(traveling(30), NOW);
    expect(next.expeditions[0].phase).not.toBe("traveling");
  });

  it("没有队伍在路上时是空操作，不会凭空造出远征", () => {
    const idle = createInitialState();
    expect(arriveNow(idle, NOW).expeditions).toEqual([]);
  });

  it("不修改传入的存档", () => {
    const before = traveling(30);
    const snapshot = JSON.stringify(before);
    arriveNow(before, NOW);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("GM：快进", () => {
  it("快进不足剩余时间时仍在路上，但剩余时间确实变短了", () => {
    const next = fastForward(traveling(30), 10 * 60_000, NOW);
    expect(next.expeditions[0].phase).toBe("traveling");
    expect(nextArrivalIn(next, NOW)).toBe(20 * 60_000);
  });

  it("快进超过剩余时间就直接抵达", () => {
    const next = fastForward(traveling(5), 10 * 60_000, NOW);
    expect(next.expeditions[0].phase).not.toBe("traveling");
  });

  it("不动战报和日志的时间戳——那是历史记录，改了时间线就乱了", () => {
    const base = traveling(30);
    const withLog: GameState = { ...base, log: [{ id: "l1", createdAt: NOW - 5_000, message: "旧日志" }] };
    expect(fastForward(withLog, 60 * 60_000, NOW).log.find(entry => entry.id === "l1")?.createdAt)
      .toBe(NOW - 5_000);
  });
});

describe("GM：伤势与金币", () => {
  it("只处理带 injuryRecoveredAt 的宠物，也就是待在基地的那些", () => {
    const base = createInitialState();
    const [id, pet] = Object.entries(base.pets)[0];
    const hurt: GameState = { ...base, pets: { ...base.pets, [id]: { ...pet, injury: "injured", injuryRecoveredAt: NOW + 3_600_000 } } };
    expect(restingInjuredCount(hurt)).toBe(1);
    expect(healResting(hurt, NOW).pets[id].injury).not.toBe("injured");

    // 出门在外的宠物没有这个字段，GM 不该替它自愈
    const away: GameState = { ...base, pets: { ...base.pets, [id]: { ...pet, injury: "injured", injuryRecoveredAt: undefined } } };
    expect(restingInjuredCount(away)).toBe(0);
    expect(healResting(away, NOW).pets[id].injury).toBe("injured");
  });

  it("加钱可以传负数，但扣不到负值", () => {
    const base = { ...createInitialState(), currency: 100 };
    expect(addCurrency(base, 1000).currency).toBe(1100);
    expect(addCurrency(base, -9999).currency).toBe(0);
  });
});

describe("GM：剩余时间显示", () => {
  it("没有队伍在路上时返回 null，抵达时间已过则夹到 0", () => {
    expect(nextArrivalIn(createInitialState(), NOW)).toBeNull();
    expect(nextArrivalIn(traveling(30), NOW)).toBe(30 * 60_000);
    expect(nextArrivalIn(traveling(-5), NOW)).toBe(0);
  });
});

describe("GM：重置抽奖次数", () => {
  it("免费次数回满、付费价格回到第 1 次，已经抽到的东西不动", () => {
    let state = addCurrency(createInitialState(), 1_000_000);
    const fresh = gachaStatus(state, NOW)!;
    for (let i = 0; i < fresh.freeLeft + 2; i++) state = drawGacha(state, NOW);
    const used = gachaStatus(state, NOW)!;
    expect(used.freeLeft).toBe(0);
    expect(used.paidCount).toBe(2);

    const reset = resetGachaDay(state);
    const status = gachaStatus(reset, NOW)!;
    expect(status.freeLeft).toBe(fresh.freeLeft);
    expect(status.paidCount).toBe(0);
    expect(status.nextPrice).toBe(fresh.nextPrice);
    expect(reset.gacha.seed).toBe(state.gacha.seed);
    expect(reset.gacha.lastPrize).toEqual(state.gacha.lastPrize);
    expect(reset.gacha.pending).toEqual(state.gacha.pending);
    expect(reset.currency).toBe(state.currency);
  });

  it("重置后能再免费抽一次", () => {
    let state = createInitialState();
    while (gachaStatus(state, NOW)!.freeLeft > 0) state = drawGacha(state, NOW);
    expect(gachaStatus(resetGachaDay(state), NOW)!.canDraw).toBe(true);
  });
});
