import authoredCatalog from "./catalog.bundled.json";
import type { Catalog } from "./types";

// 这份内置目录来自策划配置台导出的完整 Catalog。
// 后续仍可在配置台修改并导出，再覆盖 catalog.bundled.json。
export const bundledCatalog = authoredCatalog as unknown as Catalog;

export let catalog: Catalog = bundledCatalog;

export function setCatalog(nextCatalog: Catalog): void {
  catalog = nextCatalog;
}
