/** Desktop work-area coordinates, in device-independent pixels. */
export interface Rect { x: number; y: number; width: number; height: number }
export interface Layout { bounds: Rect; pet: Rect; panel: Rect | null; position: { x: number; y: number } }
export function computeLayout(position: { x: number; y: number }, area: Rect, panelId?: string | null, canvas?: number): Layout;
export function computeNativeLayout(position: { x: number; y: number }, area: Rect, panelId?: string | null, canvas?: number): Layout;
export const PANEL_WIDTHS: Record<string, number>;
export const PANEL_HEIGHTS: Record<string, number>;
