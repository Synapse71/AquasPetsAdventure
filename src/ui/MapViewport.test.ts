import { describe, expect, it } from 'vitest';
import { mapViewportGeometry } from './MapViewport';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdventureMap } from './AdventureMap';
import { createInitialState } from '../domain/engine';
import { readFileSync } from 'node:fs';

describe('固定地图视窗', () => {
  it('横向地图无需移动，纵向地图超出部分在固定视窗内平移', () => {
    expect(mapViewportGeometry(640, 360, 16 / 9, { x: 50, y: 50 })).toEqual({ width: 640, height: 360, left: 0, top: 0 });
    expect(mapViewportGeometry(640, 360, 1, { x: 50, y: 50 })).toEqual({ width: 640, height: 640, left: 0, top: 140 });
  });
  it('定位入口、终点和超宽地图时不会拖出画布边界', () => {
    expect(mapViewportGeometry(640, 360, 1, { x: 50, y: 0 }).top).toBe(0);
    expect(mapViewportGeometry(640, 360, 1, { x: 50, y: 100 }).top).toBe(280);
    expect(mapViewportGeometry(640, 360, 3, { x: 100, y: 50 })).toEqual({ width: 1080, height: 360, left: 440, top: 0 });
  });
  it('中途撤离点与终点使用不同图形并有文字图例', () => {
    const game = createInitialState(); game.unlockedMapIds.push('map-3');
    const html = renderToStaticMarkup(createElement(AdventureMap, { game, mapId: 'map-3', petIds: [] }));
    expect(html.match(/class="ap-map-node-icon exit"/g)).toHaveLength(3);
    expect(html.match(/class="ap-map-node-icon goal"/g)).toHaveLength(2);
    const exitSrc = html.match(/class="ap-map-node-icon exit" src="([^"]+)"/)?.[1];
    const goalSrc = html.match(/class="ap-map-node-icon goal" src="([^"]+)"/)?.[1];
    expect(exitSrc).toBeTruthy(); expect(goalSrc).toBeTruthy(); expect(exitSrc).not.toBe(goalSrc);
    expect(html).toContain('中途撤离点'); expect(html).toContain('拖拽查看地图');
    expect(html).toContain('ap-map-viewport');
  });
  it('视窗隐藏滚动条且拖拽不会触发节点选择', () => {
    const css = readFileSync('src/ui/adventurePrototype.css', 'utf8');
    expect(css).toMatch(/\.ap-map-viewport\s*\{[^}]*aspect-ratio:16\/9;[^}]*overflow:hidden/);
    expect(css).toContain('.ap-map-viewport::-webkit-scrollbar { display:none; }');
    const source = readFileSync('src/ui/MapViewport.tsx', 'utf8');
    expect(source).toContain('onClickCapture');
    expect(source).toContain('event.stopPropagation()');
    expect(source).toContain('setPointerCapture');
  });
});
