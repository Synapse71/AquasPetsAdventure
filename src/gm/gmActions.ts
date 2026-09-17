// GM 后台只在 import.meta.env.DEV 下存在，整个 src/gm/ 不会进打包产物
// （src/config/productionBundle.test.ts 会真的跑一次生产构建来盯这件事）。
//
// 这里只放纯函数：GM 操作和玩家操作一样必须是「旧存档 → 新存档」，
// 这样才单测得了，也才不会在面板里顺手改到别的字段。
// 改完一律再过一遍 tick——抵达、伤势恢复这些后续都走引擎原来的流程，
// GM 只负责把时间拨过去，不自己实现一套结算。
import { tick } from "../domain/engine";
import type { GameState } from "../domain/types";

/** 让所有行进中的队伍立刻抵达。只把 arriveAt 拨到当前时刻，掉落和事件仍由 tick 生成。 */
export function arriveNow(state: GameState, now: number): GameState {
  const expeditions = state.expeditions.map(expedition =>
    expedition.phase === "traveling" && expedition.arriveAt > now
      ? { ...expedition, arriveAt: now }
      : expedition,
  );
  return tick({ ...state, expeditions }, now);
}

/**
 * 把所有倒计时往前推 ms 毫秒：行进和基地伤势恢复一起走。
 * 战报和日志的 createdAt 是历史记录，不动——动了时间线就乱了。
 */
export function fastForward(state: GameState, ms: number, now: number): GameState {
  const next: GameState = {
    ...state,
    expeditions: state.expeditions.map(expedition =>
      expedition.phase === "traveling"
        ? { ...expedition, startedAt: expedition.startedAt - ms, arriveAt: expedition.arriveAt - ms }
        : expedition,
    ),
    pets: Object.fromEntries(
      Object.entries(state.pets).map(([id, pet]) => [
        id,
        pet.injuryRecoveredAt === undefined
          ? pet
          : { ...pet, injuryRecoveredAt: pet.injuryRecoveredAt - ms },
      ]),
    ),
  };
  return tick(next, now);
}

/**
 * 让**待在基地**的宠物伤势立刻进入下一档恢复。
 * 出门在外的宠物没有 injuryRecoveredAt（出发会清掉，冒险途中不自愈），
 * 这里就不碰它们——GM 要的是省时间，不是把规则改成「途中也能自愈」。
 */
export function healResting(state: GameState, now: number): GameState {
  const pets = Object.fromEntries(
    Object.entries(state.pets).map(([id, pet]) => [
      id,
      pet.injuryRecoveredAt === undefined ? pet : { ...pet, injuryRecoveredAt: now },
    ]),
  );
  return tick({ ...state, pets }, now);
}

/** 加钱。可以传负数，扣到 0 为止。 */
export function addCurrency(state: GameState, amount: number): GameState {
  return { ...state, currency: Math.max(0, state.currency + amount) };
}

/** 有几只宠物正在基地养伤——决定「伤势痊愈」按钮要不要点得动。 */
export function restingInjuredCount(state: GameState): number {
  return Object.values(state.pets).filter(pet => pet.injuryRecoveredAt !== undefined).length;
}

/** 最近一次抵达还要多久（毫秒）；没有队伍在路上时返回 null。 */
export function nextArrivalIn(state: GameState, now: number): number | null {
  const pending = state.expeditions
    .filter(expedition => expedition.phase === "traveling")
    .map(expedition => expedition.arriveAt - now);
  return pending.length ? Math.max(0, Math.min(...pending)) : null;
}
