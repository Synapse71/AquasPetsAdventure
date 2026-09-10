import type { Layout } from '../../desktop/geometry.mjs';

export interface DesktopState { layout: Layout; canvas: number; alwaysOnTop: boolean }
export interface DesktopBridge {
  getState(): Promise<DesktopState>;
  setPanel(panel: string | null): Promise<DesktopState>;
  setIgnoreMouse(ignore: boolean): void;
  startDrag(point: { x: number; y: number }): void;
  dragTo(point: { x: number; y: number }): void;
  endDrag(): void;
  settings(value: { canvas?: number; alwaysOnTop?: boolean }): Promise<DesktopState>;
  hide(): void;
  quit(): void;
  onLayout(callback: (state: DesktopState) => void): () => void;
  onClosePanels(callback: () => void): () => void;
}
declare global { interface Window { desktopPet?: DesktopBridge } }
