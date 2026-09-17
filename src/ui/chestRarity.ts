// 开箱动画分两套：战利品里只有普通物品时用原来的木箱动画，出了更高稀有度就播对应档位的
// 开箱视频。判定只看这次到站开出的东西（arrivalLoot），拾取与否不影响已经播过的动画。
//
// 素材由 tools/build-chest-rarity.py 从原片产出，保留原片自带的纯白背景——面板本来就是白的，
// 直接铺上去即可，不抠图。摆放方式见 adventurePrototype.css 里的 .ap-chest-fx。
import { catalog } from "../domain/catalog";
import { rarityRank, type Rarity } from "../domain/rarity";

const clips = import.meta.glob<string>("../../assets/ui-prototype/chest/rarity-v1/*/open-anim.mp4", { eager: true, query: "?url", import: "default" });
const closedStills = import.meta.glob<string>("../../assets/ui-prototype/chest/rarity-v1/*/closed-still.webp", { eager: true, query: "?url", import: "default" });
const stills = import.meta.glob<string>("../../assets/ui-prototype/chest/rarity-v1/*/open-still.webp", { eager: true, query: "?url", import: "default" });

/** 原片 121 帧 @24fps。视频没能播（解码失败、被策略挡住）时靠它兜底收尾。 */
export const RARITY_CHEST_MS = 5040;

/** 战利品里的最高稀有度；空战利品和查不到的物品都按 common 算。 */
export function topLootRarity(
  loot: Record<string, number> | undefined,
  rarityOf: (id: string) => Rarity | undefined = id => catalog.items[id]?.rarity,
): Rarity {
  let top: Rarity = "common";
  for (const [id, quantity] of Object.entries(loot ?? {})) {
    if (!(quantity > 0)) continue;
    const rarity = rarityOf(id);
    if (rarity && rarityRank(rarity) > rarityRank(top)) top = rarity;
  }
  return top;
}

/**
 * 该稀有度的整套开箱素材：闭合首帧 / 视频 / 末帧，三者同属一套画布。
 * 闭合图必须来自这段视频自己——拿通用木箱当闭合图的话，点下去宝箱会当场换一只还跳尺寸。
 *
 * 查不到就返回 null，表示「这一档维持原来的木箱动画」。目前只有 common 走这条路；
 * 哪天补上 common/ 的素材，这里会自动认出来，不用改代码。
 */
export function rarityChestFx(rarity: Rarity): { closed: string; clip: string; still: string } | null {
  const base = `../../assets/ui-prototype/chest/rarity-v1/${rarity}`;
  const closed = closedStills[`${base}/closed-still.webp`];
  const clip = clips[`${base}/open-anim.mp4`];
  const still = stills[`${base}/open-still.webp`];
  return closed && clip && still ? { closed, clip, still } : null;
}
