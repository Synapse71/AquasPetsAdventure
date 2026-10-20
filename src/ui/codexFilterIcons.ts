import type { CodexFilter } from './codexGroups';
import all from '../../assets/ui-prototype/icons/codex-filter/all.png';
import common from '../../assets/ui-prototype/icons/codex-filter/common.png';
import uncommon from '../../assets/ui-prototype/icons/codex-filter/uncommon.png';
import rare from '../../assets/ui-prototype/icons/codex-filter/rare.png';
import epic from '../../assets/ui-prototype/icons/codex-filter/epic.png';
import legendary from '../../assets/ui-prototype/icons/codex-filter/legendary.png';
import mythic from '../../assets/ui-prototype/icons/codex-filter/mythic.png';
import collectible from '../../assets/ui-prototype/icons/codex-filter/collectible.png';

/** 图鉴筛选按钮的图标（GPT Image 2.5 出图，管线见 assets/ui-prototype/icons/codex-filter/）。
 *  透明底 PNG，底色由按钮按稀有度铺（见 CodexPanel）。 */
export const CODEX_FILTER_ICONS: Partial<Record<CodexFilter, string>> = { all, common, uncommon, rare, epic, legendary, mythic, collectible };
