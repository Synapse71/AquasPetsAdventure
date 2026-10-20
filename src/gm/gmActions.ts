// GM 后台只在 import.meta.env.DEV 下存在，整个 src/gm/ 不会进打包产物
// （src/config/productionBundle.test.ts 会真的跑一次生产构建来盯这件事）。
//
// 这里只放纯函数：GM 操作和玩家操作一样必须是「旧存档 → 新存档」，
// 这样才单测得了，也才不会在面板里顺手改到别的字段。
// 改完一律再过一遍 tick——抵达、伤势恢复这些后续都走引擎原来的流程，
// GM 只负责把时间拨过去，不自己实现一套结算。
import { catalog as defaultCatalog } from "../domain/catalog";
import { tick } from "../domain/engine";
import type { Catalog, GameState, Pet } from "../domain/types";

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

/**
 * 重置今天的抽奖次数，相当于跨过了每日重置点：免费次数回满，付费价格回到第 1 次。
 * 随机种子、待领取的道具、上一次的奖品都不动——GM 要的是能再抽，不是清掉已经抽到的东西。
 */
export function resetGachaDay(state: GameState): GameState {
  return { ...state, gacha: { ...state.gacha, freeUsed: 0, paidCount: 0 } };
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

/**
 * 加一只测试宠物，用来看多宠物时的界面（状态面板头像栏等）。复制第一份宠物模板、换个 id 和名字；
 * 单数号带 3 点待分配，双数号带伤（30 分钟后好转），两种角标都能看到。
 */
export function addTestPet(state: GameState, now: number, catalog: Catalog = defaultCatalog): GameState {
  const template = Object.values(catalog.petTemplates)[0];
  if (!template) return state;
  let n = 1;
  while (state.pets[`gm-pet-${n}`]) n += 1;
  const pet: Pet = { ...structuredClone(template), id: `gm-pet-${n}`, name: `测试伙伴${n}` };
  if (n % 2) pet.unspentPoints = 3;
  else { pet.injury = "injured"; pet.injuryRecoveredAt = now + 30 * 60_000; }
  return { ...state, pets: { ...state.pets, [pet.id]: pet } };
}

const isTestPet = (id: string) => id.startsWith("gm-pet-");

/** 能移除的测试宠物数：在外探险的不算，等它回来再删，免得队伍里凭空少一只。 */
export function removableTestPetCount(state: GameState): number {
  const away = new Set(state.expeditions.flatMap(expedition => expedition.petIds));
  return Object.keys(state.pets).filter(id => isTestPet(id) && !away.has(id)).length;
}

/** 删掉 addTestPet 加的、待在基地的测试宠物；战报里的名字也一并去掉。正式宠物不动。 */
export function removeTestPets(state: GameState): GameState {
  const away = new Set(state.expeditions.flatMap(expedition => expedition.petIds));
  const gone = (id: string) => isTestPet(id) && !away.has(id);
  return {
    ...state,
    pets: Object.fromEntries(Object.entries(state.pets).filter(([id]) => !gone(id))),
    settlements: state.settlements.map(settlement => ({ ...settlement, petIds: settlement.petIds.filter(id => !gone(id)) })),
  };
}
