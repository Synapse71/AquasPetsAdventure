import { describe, it, expect } from 'vitest';
import { computeLayout, computeNativeLayout, computeResizePreview, PANEL_WIDTHS, petMetrics } from '../../desktop/geometry.mjs';
const area = { x: 0, y: 25, width: 1440, height: 850 };
describe('desktop layout', () => {
  it('uses one frame and reserves external bookmarks on every screen', () => {
    for (const workArea of [area, {x:-800,y:0,width:800,height:600}]) {
      const first = computeNativeLayout({x:100,y:100}, workArea, 'pets');
      for (const id of Object.keys(PANEL_WIDTHS)) {
        const next=computeNativeLayout({x:100,y:100},workArea,id);
        expect(next.panel).toEqual(first.panel);
        expect(next.panel!.x).toBeGreaterThanOrEqual(44);
        expect(next.bounds.x+next.panel!.x-44).toBeGreaterThanOrEqual(workArea.x+8);
      }
    }
  });
  it('locks native bounds and panel coordinates throughout a resize gesture', () => {
    const start = computeNativeLayout({ x: 600, y: 250 }, area, 'settings', 300);
    for (const size of [130, 420, 180, 300]) {
      const preview = computeResizePreview(start, size);
      expect(preview.bounds).toEqual(start.bounds);
      expect(preview.panel).toEqual(start.panel);
      expect(preview.pet.width).toBe(size);
      expect(preview.pet.x).toBeGreaterThanOrEqual(0);
      expect(preview.pet.x + size).toBeLessThanOrEqual(start.bounds.width);
    }
  });
  it('halves the former minimum while keeping menu targets readable and inside the window', () => {
    expect(petMetrics(130).size).toBe(petMetrics(260).size / 2);
    expect(petMetrics(0).size).toBe(130);
    expect(petMetrics(999).size).toBe(420);
    expect(petMetrics(300).bubble).toBe(42);
    expect(petMetrics(130).bubble).toBe(16);
    expect(petMetrics(130).menuWidth).toBe(92);
    for (const size of [130, 180, 260, 300, 420]) {
      const metrics = petMetrics(size);
      expect(metrics.bubble).toBeGreaterThanOrEqual(16);
      for (const x of [-9999, 9999]) {
        const layout = computeLayout({ x, y: 9999 }, area, null, size);
        const left = layout.pet.x + (size - metrics.menuWidth) / 2;
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left + metrics.menuWidth).toBeLessThanOrEqual(layout.bounds.width);
        expect(48 + size * .94 + metrics.bubble).toBeLessThan(layout.pet.height);
      }
    }
  });
  it('keeps native bounds and local pet coordinates identical across every panel transition', () => {
    for (const workArea of [area, { x: -1920, y: -1080, width: 1920, height: 1080 }, { x: 0, y: 0, width: 800, height: 600 }]) {
      for (const canvas of [130, 180, 260, 300, 420]) {
        for (const position of [{ x: 100, y: 100 }, { x: 1100, y: 400 }, { x: -1800, y: -900 }]) {
          const closed = computeNativeLayout(position, workArea, null, canvas);
          expect(closed.panel).toBeNull();
          for (const id of Object.keys(PANEL_WIDTHS)) {
            const open = computeNativeLayout(position, workArea, id, canvas);
            expect(open.bounds).toEqual(closed.bounds);
            expect(open.pet).toEqual(closed.pet);
            expect(open.position).toEqual(closed.position);
            const normal = computeLayout(position, workArea, id, canvas);
            expect(open.panel!.x + open.bounds.x).toBe(normal.panel!.x + normal.bounds.x);
            expect(open.panel!.y + open.bounds.y).toBe(normal.panel!.y + normal.bounds.y);
            expect(open.panel!.width).toBe(normal.panel!.width);
            expect(open.panel!.height).toBe(normal.panel!.height);
          }
          expect(closed.bounds.x).toBeGreaterThanOrEqual(workArea.x);
          expect(closed.bounds.y).toBeGreaterThanOrEqual(workArea.y);
          expect(closed.bounds.x + closed.bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width);
          expect(closed.bounds.y + closed.bounds.height).toBeLessThanOrEqual(workArea.y + workArea.height);
        }
      }
    }
  });
  it('reserves the full fixed status prototype height without moving the pet', () => {
    const position = { x: 1100, y: 400 };
    const result = computeLayout(position, area, 'pets');
    expect(result.panel?.width).toBe(812);
    expect(result.panel?.height).toBe(750);
    expect(result.position).toEqual(position);
  });
  it('only allocates the pet rectangle while folded', () => {
    const layout = computeLayout({ x: 100, y: 100 }, area);
    expect(layout.bounds).toEqual({ x: 100, y: 100, width: 300, height: 380 });
    expect(layout.panel).toBeNull();
  });
  it('keeps the pet stationary while placing the inventory to its left', () => {
    const closed = computeLayout({ x: 1100, y: 400 }, area);
    const open = computeLayout(closed.position, area, 'inventory');
    expect(open.position).toEqual(closed.position);
    expect(open.panel!.width).toBe(812);
    expect(open.panel!.x + open.panel!.width).toBeLessThan(open.pet.x);
  });
  it('allows panel overlap when neither side fits, without moving the pet', () => {
    const position = { x: 500, y: 300 };
    const layout = computeLayout(position, area, 'adventure');
    expect(layout.position).toEqual(position);
    expect(layout.bounds.x + layout.panel!.x).toBeGreaterThanOrEqual(area.x);
    expect(layout.bounds.x + layout.panel!.x + layout.panel!.width).toBeLessThanOrEqual(area.width);
  });
  it('clamps to the work area and supports monitors with negative coordinates', () => {
    const monitor = { x: -1920, y: -1080, width: 1920, height: 1080 };
    const result = computeLayout({ x: -2000, y: -2000 }, monitor);
    expect(result.bounds).toEqual({ x: -1920, y: -1080, width: 300, height: 380 });
  });
  it('fits panels on small displays', () => {
    const result = computeLayout({ x: 900, y: 900 }, { x: 0, y: 0, width: 800, height: 600 }, 'inventory');
    expect(result.panel!.width).toBe(740);
    expect(result.panel!.height).toBe(584);
    expect(result.bounds.width).toBeLessThanOrEqual(800);
    expect(result.bounds.height).toBeLessThanOrEqual(600);
  });
});
