/** Desktop work-area coordinates, in device-independent pixels. */
export interface Rect { x: number; y: number; width: number; height: number }
export interface Layout { bounds: Rect; pet: Rect; panel: Rect | null; position: { x: number; y: number } }
export function computeLayout(position: { x: number; y: number }, area: Rect, panelId?: string | null, canvas?: number): Layout;
export function computeNativeLayout(position: { x: number; y: number }, area: Rect, panelId?: string | null, canvas?: number): Layout;
export const PANEL_WIDTHS: Record<string, number>;
export const PANEL_HEIGHTS: Record<string, number>;
export const BOOKMARK_WIDTH: number;
export const MIN_PET_CANVAS: number;
export const MAX_PET_CANVAS: number;
export function petMetrics(canvas?: number): { size: number; bubble: number; gap: number; menuWidth: number; height: number };
export function computeResizePreview(start: Layout, canvas: number): Layout;
