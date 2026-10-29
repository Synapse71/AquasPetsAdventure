import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mapArtwork } from './mapArtwork';
import { AdventureMap } from './AdventureMap';
import { MapForm } from '../config/MapForm';
import { bundledCatalog } from '../domain/catalog';
import { createInitialState } from '../domain/engine';

describe('榆湾地图展示', () => {
  it('两个入口都可选择，选中第二入口时名称与选中态一致', () => {
    const game = createInitialState();
    game.unlockedMapIds.push('map-3');
    const markup = renderToStaticMarkup(createElement(AdventureMap, {
      game, mapId: 'map-3', petIds: [], picking: true, pickedNodeId: 'm3-s2',
    }));
    expect(markup).toContain(mapArtwork['map-3']);
    expect(markup).toContain('transform:scale(1)');
    expect(markup).toContain('已选择入口：镇南公交站');
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="河畔步行桥"');
    expect(markup).toContain('aria-label="镇南公交站"');
    expect(markup).toContain('共 2 个入口');
  });

  it('B 版底图显示实际布局和完整拓扑，第二入口不会标成不可达', () => {
    const markup = renderToStaticMarkup(createElement(MapForm, {
      record: bundledCatalog.maps['map-3'] as unknown as Record<string, unknown>,
      catalog: bundledCatalog, onChange: () => {},
    }));
    expect(markup).toContain(mapArtwork['map-3']);
    expect(markup).toContain('transform:scale(1)');
    expect(markup).toContain('地图布局与锚点');
    expect(markup).toContain('实际位置上的单向路线');
    expect(markup).toContain('19 个节点');
    expect(markup).toContain('26 条单向路径');
    expect(markup.match(/class="config-graph-node entry/g)).toHaveLength(2);
    expect(markup.match(/class="config-graph-node extractable/g)).toHaveLength(3);
    expect(markup.match(/class="config-graph-node terminal/g)).toHaveLength(2);
    expect(markup).not.toContain('入口无法到达');
  });
});
