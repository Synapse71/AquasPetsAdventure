import { afterEach, describe, expect, it } from 'vitest';
import { bundledCatalog, catalog, setCatalog } from '../domain/catalog';
import { itemTooltipInfo } from './itemTooltipModel';

afterEach(() => setCatalog(bundledCatalog));

describe('物品悬浮提示', () => {
  it('重量、售价、标签、堆叠都按当前这一格给出', () => {
    const info = itemTooltipInfo('cloth-strip', 20)!;
    expect(info.name).toBe('布条');
    expect(info.rarityLabel).toBe('常见');
    expect(info.tags).toEqual(['材料']);
    expect(info.facts).toEqual([
      { label: '堆叠', value: '每格 20 件' },
      { label: '重量', value: '2（单重 0.1）' },
      { label: '售价', value: '5 ／ 件（本格 100）' },
    ]);
    expect(info.effects).toEqual([]);
  });

  it('不传数量时只报单件口径', () => {
    expect(itemTooltipInfo('hemp-rope')!.facts).toEqual([
      { label: '堆叠', value: '每格 12 件' },
      { label: '重量', value: '0.3' },
      { label: '售价', value: '6 ／ 件' },
    ]);
  });

  it('传说物品把描述一起显示', () => {
    const info = itemTooltipInfo('card-stoat', 1)!;
    expect(info.rarityLabel).toBe('传说');
    expect(info.tags).toEqual(['收藏品']);
    expect(info.description).toContain('白鼬');
  });

  it('成长道具、特质道具、食物各写各的效果', () => {
    expect(itemTooltipInfo('bubugao-dianduji')!.effects).toEqual(['使用后 学识 +2（永久生效，上限 20）']);
    expect(itemTooltipInfo('canned-food')!.effects).toEqual(['出发前吃下：体能 +1，整趟冒险有效（同时只能有一个）']);
    expect(itemTooltipInfo('chocolate')!.effects).toEqual(['吃下恢复 1 档伤势']);
  });

  it('赋予特质的道具写出特质名', () => {
    const tagId = Object.keys(catalog.tags)[0];
    setCatalog({ ...catalog, items: { ...catalog.items, ticket: { ...catalog.items.paper, id: 'ticket', tagGrantId: tagId } } });
    expect(itemTooltipInfo('ticket')!.effects).toEqual([`使用后永久赋予特质「${catalog.tags[tagId].name}」`]);
  });

  it('不可出售的物品写明不可出售', () => {
    setCatalog({ ...catalog, items: { ...catalog.items, paper: { ...catalog.items.paper, sellable: false, sellValue: undefined } } });
    expect(itemTooltipInfo('paper', 3)!.facts).toEqual([
      { label: '堆叠', value: '每格 20 件' },
      { label: '重量', value: '0.3（单重 0.1）' },
      { label: '售价', value: '不可出售' },
    ]);
  });

  it('未知物品没有提示', () => {
    expect(itemTooltipInfo('not-an-item')).toBeUndefined();
  });
});
