import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { catalog } from '../domain/catalog';
import { applySecondaryGrantItem, applyTagItem, healPetWithFood, STAT_LABELS, cargoCapacity, cargoSlotCapacity, cargoSlotsUsed, discardCargo,
  GameRuleError, inventoryWeight, itemStackSize, petSecondaryStat, secondaryStatCap, SECONDARY_STAT_LABELS,
  sellWarehouseItems, toggleItemLock, warehouseSlotsUsed } from '../domain/engine';
import { itemTagLabel } from '../domain/itemTags';
import { RARITY_LABELS, rarityRank, type Rarity } from '../domain/rarity';
import type { GameState, Inventory, Pet } from '../domain/types';
import { lootIconUrl } from './lootIcons';
import { ItemTooltip } from './ItemTooltip';
import { menuIcon } from './PetDesktop';
import { useUIState } from './uiState';
import { cleanPicked, cellLimit, cellRef, cellRefs, discardBasis, foodHealPreview, initialInventoryView, inventoryCells, isInventoryDialog, isInventoryView,
  itemCount, pickedQuantities, saleBasis, saleValue, sellable, sortedInventory, usableOnPet, useBasis, useBlockReason, validInventoryDialog,
  type InventoryDialog, type InventoryView, type SortKey } from './inventoryPanelModel';
import './inventoryPanel.css';

const COLORS: Record<Rarity, string> = { common: '#e3e3e3', uncommon: '#a8dc82', rare: '#74b9f0', epic: '#b98bee', legendary: '#f3c63c', mythic: '#f08a86' };
const num = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
const itemStyle = (id: string): CSSProperties => ({ background: COLORS[catalog.items[id]?.rarity ?? 'common'] });
function ItemArt({ id }: { id: string }) {
  const url = lootIconUrl(id);
  return url ? <img src={url} alt="" draggable={false} /> : <span className="ip-missing-art" aria-label="暂无图标">◇</span>;
}
function Coin({ value }: { value: number }) { return <span className="ip-coin"><img src={menuIcon('coin')} alt="通用货币" />{num(value)}</span>; }
function Lock() { return <span className="ip-lock" aria-label="已锁定"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" strokeWidth="2.5" /></svg></span>; }
function usePreview(pet: Pet, itemId: string) {
  const item = catalog.items[itemId];
  if (item.tagGrantId) return `永久获得「${catalog.tags[item.tagGrantId]?.name ?? item.tagGrantId}」`;
  if (item.foodHeal && !item.secondaryGrant) return `伤势 ${foodHealPreview(pet, item.foodHeal.steps)}`;
  if (!item.secondaryGrant) return '无法使用';
  const g = item.secondaryGrant, current = petSecondaryStat(pet, g.stat), next = Math.min(secondaryStatCap(), current + g.amount);
  return `${SECONDARY_STAT_LABELS[g.stat]} ${current} → ${next}${current + g.amount > secondaryStatCap() ? `（超出 ${current + g.amount - secondaryStatCap()} 点将浪费）` : ''}`;
}

export function InventoryPanel({ game, run, onClose, active, reports }: {
  game: GameState; run: (action: (state: GameState) => GameState) => boolean;
  onClose: () => void; active: boolean; reports: ReactNode;
}) {
  const [view, setView] = useUIState<InventoryView>('inventory-view', initialInventoryView, isInventoryView);
  const [section, setSection] = useUIState<'warehouse' | 'cargo'>('inventory-section', 'warehouse', (v): v is 'warehouse' | 'cargo' => v === 'warehouse' || v === 'cargo');
  const [dialog, setDialog] = useUIState<InventoryDialog | null>('inventory-dialog', null, isInventoryDialog);
  const [menu, setMenu] = useState<{ id: string; index: number; x: number; y: number } | null>(null);
  const [tip, setTip] = useState<{ id: string; quantity: number; x: number; y: number } | null>(null);
  // 格子本身只画图标和数量，重量、售价、标签、效果、描述全部走悬浮提示。
  const showTip = (el: HTMLElement, id: string, quantity: number) => {
    const r = el.getBoundingClientRect();
    setTip({ id, quantity, x: Math.max(8, Math.min(window.innerWidth - 280, r.right + 8)), y: Math.max(8, Math.min(window.innerHeight - 240, r.top - 4)) });
  };
  const [message, setMessage] = useState('');
  const root = useRef<HTMLDivElement>(null), modal = useRef<HTMLDivElement>(null);
  const update = (patch: Partial<InventoryView>) => setView(old => ({ ...old, ...patch }));
  const picked = cleanPicked(game, view.picked);
  const dialogValid = validInventoryDialog(game, dialog);
  useEffect(() => {
    if (JSON.stringify(picked) !== JSON.stringify(view.picked)) setView(old => ({ ...old, picked }));
  }, [game, view.picked, setView]);
  useEffect(() => {
    if (!dialogValid) { setDialog(null); setMessage('物品或伙伴状态已变化，请重新确认操作。'); }
  }, [dialogValid, setDialog]);
  useEffect(() => { if (!active) setMenu(null); }, [active]);
  useEffect(() => {
    if (active && dialog) modal.current?.querySelector<HTMLElement>('button:not(:disabled), input')?.focus({ preventScroll: true });
  }, [active, dialog?.type]);
  const entries = sortedInventory(game.inventory, view.sort, view.direction);
  const cells = inventoryCells(entries);
  const selectedId = entries.some(([id]) => id === view.selected) ? view.selected : entries[0]?.[0];
  const item = selectedId ? catalog.items[selectedId] : undefined, quantity = selectedId ? game.inventory[selectedId] : 0;
  const expedition = game.expeditions.find(e => e.id === view.expeditionId) ?? game.expeditions[0];
  const cargoCells = inventoryCells(Object.entries(expedition?.cargo ?? {}));
  const weight = expedition ? inventoryWeight(expedition.cargo) : 0;
  const capacity = expedition ? cargoCapacity(game, expedition) : 0;
  const slots = expedition ? cargoSlotsUsed(expedition) : 0;
  const slotCapacity = expedition ? cargoSlotCapacity(game, expedition) : 0;
  const canDiscard = !!expedition && ['awaiting-route', 'awaiting-event', 'extraction'].includes(expedition.phase);
  const eligible = entries.filter(([id]) => sellable(game, id)).flatMap(([id, quantity]) => cellRefs(id, quantity));
  const excluded = entries.filter(([id]) => !sellable(game, id)).length;
  const pickedQuantitiesMap = pickedQuantities(game, picked);
  const selectedCount = itemCount(pickedQuantitiesMap);
  const openSale = (quantities: Inventory, single?: { id: string; cellIndex: number }) => {
    setMenu(null); setDialog({ type: 'sale', quantities, singleId: single?.id, cellIndex: single?.cellIndex, basis: saleBasis(game, quantities) });
  };
  // 单格售卖的上限就是玩家点的那一格，不是这一类物品的总数。
  const saleLimit = dialog?.type === 'sale' && dialog.singleId ? cellLimit(game.inventory[dialog.singleId], dialog.singleId, dialog.cellIndex ?? 0) : 0;
  // 丢弃同理：上限只取被点的那一格。
  const discardLimit = dialog?.type === 'discard' ? cellLimit(game.expeditions.find(e => e.id === dialog.expeditionId)?.cargo[dialog.itemId], dialog.itemId, dialog.cellIndex) : 0;
  const setSaleQuantity = (q: number) => {
    if (dialog?.type !== 'sale' || !dialog.singleId || !saleLimit) return;
    const id = dialog.singleId;
    setDialog({ ...dialog, quantities: { [id]: Math.max(1, Math.min(saleLimit, Math.trunc(q) || 1)) } });
  };
  const commit = () => {
    if (!dialog || dialog.type === 'reports') return;
    const succeeded = run(state => {
      if (!validInventoryDialog(state, dialog)) throw new GameRuleError('物品或伙伴状态已变化，请重新确认。');
      if (dialog.type === 'sale') return sellWarehouseItems(state, dialog.quantities);
      if (dialog.type === 'discard') return discardCargo(state, dialog.expeditionId, dialog.itemId, dialog.quantity);
      const pet = state.pets[dialog.petId];
      if (!pet) throw new GameRuleError('请先选择伙伴。');
      const reason = useBlockReason(pet, dialog.itemId, state);
      if (reason) throw new GameRuleError(reason);
      const used = catalog.items[dialog.itemId];
      if (used.tagGrantId) return applyTagItem(state, pet.id, dialog.itemId);
      if (used.secondaryGrant) return applySecondaryGrantItem(state, pet.id, dialog.itemId);
      return healPetWithFood(state, pet.id, dialog.itemId);
    });
    if (succeeded) {
      setMessage(dialog.type === 'sale' ? `已售出 ${itemCount(dialog.quantities)} 件，获得 ${num(saleValue(dialog.quantities))} 通用货币` : dialog.type === 'discard' ? '已丢弃所选物品' : '道具已使用，效果已永久生效');
      if (dialog.type === 'sale') update({ picked: [] });
      setDialog(null);
    }
  };
  return <div className="inventory-panel" ref={root} onClick={() => { setMenu(null); setTip(null); }} data-testid="inventory-panel">
    <header className="ip-header">
      <h1 id="window-title-inventory">库存</h1>
      <nav className="ip-tabs" aria-label="库存分类">
        <button aria-pressed={section === 'warehouse'} onClick={() => { setSection('warehouse'); setMenu(null); setTip(null); }}>库存</button>
        <button aria-pressed={section === 'cargo'} onClick={() => { setSection('cargo'); setMenu(null); setTip(null); }}>冒险背包</button>
      </nav>
      <Coin value={game.currency} />
      <button className="ip-reports" onClick={() => setDialog({ type: 'reports' })}>战报{game.settlements.length ? ` ${game.settlements.length}` : ''}</button>
      <button className="ip-close" aria-label="关闭库存" onClick={onClose}>×</button>
    </header>
    {section === 'cargo' ? <div className="ip-cargo-page">
    <div className="ip-transit">
      {!expedition ? <span className="ip-idle">当前没有队伍在外探险</span> : <>
        <div className="ip-expedition-label">
          {game.expeditions.length > 1 ? <select aria-label="选择探险队伍" value={expedition.id} onChange={e => update({ expeditionId: e.target.value })}>{game.expeditions.map(e => <option key={e.id} value={e.id}>{e.petIds.map(id => game.pets[id]?.name).join('、')}</option>)}</select> : <span title={expedition.petIds.map(id => game.pets[id]?.name).join('、')}>{expedition.petIds.map(id => game.pets[id]?.name).join('、')}</span>}
        </div>
        <div className="ip-cargo-slots" aria-label="探险背包格子">{Array.from({ length: Math.max(slotCapacity, cargoCells.length) }, (_, index) => {
          const cell = cargoCells[index];
          return <div key={index} className={`ip-slot${cell ? ' filled' : ''}`} data-item-id={cell?.id} style={cell ? itemStyle(cell.id) : undefined} title={cell ? undefined : '空格子'} onMouseEnter={cell ? e => showTip(e.currentTarget, cell.id, cell.quantity) : undefined} onMouseLeave={() => setTip(null)}>{cell && <><ItemArt id={cell.id} />{itemStackSize(cell.id) > 1 && <span className="ip-qty">{cell.quantity}</span>}</>}</div>;
        })}</div>
        <div className={`ip-gauge${weight > capacity ? ' over' : ''}`} data-testid="cargo-weight"><span>负重</span><div className="ip-track"><i style={{ width: `${capacity ? Math.min(100, weight / capacity * 100) : weight ? 100 : 0}%` }} /></div><span>{num(weight)} / {num(capacity)}</span></div>
        <span className={`ip-gauge${slots > slotCapacity ? ' over' : ''}`} data-testid="cargo-slots">格子 {slots} / {slotCapacity}</span>
      </>}
    </div>
    {expedition && <div className="ip-cargo-list">
      <div className="ip-cargo-heading"><strong>{catalog.maps[expedition.mapId]?.name} · 背包明细</strong><span>每行一格 · 总重 / 总价值</span></div>
      {cargoCells.map(cell => <div className="ip-cargo-row" key={`${cell.id}-${cell.index}`} data-cell-index={cell.index} title={`${catalog.items[cell.id]?.name ?? cell.id} · 第 ${cell.index + 1} 格，共 ${cell.quantity} 件`} onMouseEnter={e => showTip(e.currentTarget, cell.id, cell.quantity)} onMouseLeave={() => setTip(null)}>
        <div className="ip-row-art"><ItemArt id={cell.id} /></div><span className="ip-row-name">{catalog.items[cell.id]?.name ?? cell.id} ×{cell.quantity}<small className="ip-row-slot">第 {cell.index + 1}/{Math.ceil((expedition.cargo[cell.id] ?? 0) / itemStackSize(cell.id))} 格</small></span>
        <span>{num((catalog.items[cell.id]?.weight ?? 0) * cell.quantity)}</span><span>{catalog.items[cell.id]?.sellable ? num((catalog.items[cell.id].sellValue ?? 0) * cell.quantity) : '不可售'}</span>
        <button className="ip-drop" disabled={!canDiscard} title={!canDiscard ? '行进途中不能整理背包' : '只丢弃这一格的数量'} onClick={() => { setTip(null); setDialog({ type: 'discard', expeditionId: expedition.id, itemId: cell.id, quantity: 1, cellIndex: cell.index, basis: discardBasis(game, expedition.id, cell.id) }); }}>丢弃</button>
      </div>)}
      {!cargoCells.length && <p className="ip-empty">背包里还没有物品。</p>}
      {!canDiscard && <p className="ip-hint">行进途中不能整理背包，到达节点后可丢弃。</p>}
      {(weight > capacity || slots > slotCapacity) && <p className="ip-overload">{weight > capacity && `负重超出 ${num(weight - capacity)}，仅增加事件风险，不影响撤离。`}{slots > slotCapacity && `格子超出 ${slots - slotCapacity} 格，需整理后才能继续行进，但仍可撤离。`}</p>}
    </div>}
    </div> : <div className="ip-warehouse-page">
      <div className="ip-toolbar">
      <div className="ip-sort" aria-label="物品排序">{(['value', 'weight', 'rarity'] as SortKey[]).map(key => <button key={key} aria-pressed={view.sort === key} onClick={() => update({ sort: key })}>{key === 'value' ? '价值' : key === 'weight' ? '重量' : '稀有度'}</button>)}</div>
      <button className="ip-direction" title="切换升序 / 降序" aria-label={view.direction === -1 ? '改为升序' : '改为降序'} onClick={() => update({ direction: view.direction === -1 ? 1 : -1 })}>{view.direction === -1 ? '↓' : '↑'}</button>
      <button className="ip-bulk-toggle" aria-pressed={view.bulk} onClick={() => update({ bulk: !view.bulk, picked: [] })}>{view.bulk ? '退出批量' : '批量售卖'}</button>
      </div>
    <div className="ip-body">
      <div className="ip-grid-wrap" onScroll={() => { setMenu(null); setTip(null); }}>
        {view.bulk && <p className="ip-bulk-note">按格选择：点哪一格就只卖哪一格里的数量，同名的其它格子不受影响。</p>}
        <div className="ip-grid" aria-label="仓库物品格">{Array.from({ length: Math.max(game.warehouseSlots, cells.length) }, (_, index) => {
          const cell = cells[index];
          if (!cell) return <div className="ip-cell empty" key={`empty-${index}`} aria-label="空格子" />;
          const id = cell.id, ref = cellRef(id, cell.index), locked = game.lockedItemIds.includes(id);
          const taken = picked.includes(ref), selected = view.bulk ? taken : selectedId === id && view.cell === cell.index;
          return <button className={`ip-cell${taken ? ' picked' : ''}`} key={`${id}-${cell.index}`} data-item-id={id} style={itemStyle(id)}
            aria-label={`${catalog.items[id].name} ×${cell.quantity}${locked ? '，已锁定' : ''}`} aria-pressed={selected} disabled={view.bulk && !sellable(game, id)}
            onMouseEnter={e => showTip(e.currentTarget, id, cell.quantity)} onMouseLeave={() => setTip(null)} onFocus={e => showTip(e.currentTarget, id, cell.quantity)} onBlur={() => setTip(null)} onClick={e => {
              e.stopPropagation();
              setTip(null);
              update({ selected: id, cell: cell.index });
              // 选中粒度是格：点哪一格就只动哪一格，同名的其它格子不受影响。
              if (view.bulk) { update({ picked: taken ? picked.filter(one => one !== ref) : [...picked, ref] }); return; }
              const r = e.currentTarget.getBoundingClientRect(), host = root.current!.getBoundingClientRect();
              setMenu(menu?.id === id && menu.index === cell.index ? null : { id, index: cell.index, x: Math.max(8, Math.min(r.right - host.left + 4, host.width - 154)), y: Math.max(8, Math.min(r.top - host.top, host.height - 136)) });
            }}>
            <ItemArt id={id} />{locked && <Lock />}{itemStackSize(id) > 1 && <span className="ip-qty">{cell.quantity}</span>}{taken && <span className="ip-tick">✓</span>}
          </button>;
        })}</div>
        {!entries.length && <p className="ip-empty">库存空空的，去探索带回一些发现吧。</p>}
      </div>
      <aside className="ip-detail" aria-label="物品详情">
        {item && selectedId ? <>
          <div className="ip-detail-art" style={itemStyle(selectedId)}><ItemArt id={selectedId} /></div>
          <p className="ip-description" title={rarityRank(item.rarity) >= rarityRank('legendary') ? item.description : undefined}>{rarityRank(item.rarity) >= rarityRank('legendary') ? item.description : ''}</p>
          <dl>
            <div><dt>名称</dt><dd>{item.name}</dd></div>
            <div><dt>稀有度</dt><dd><span className="ip-rarity" style={itemStyle(selectedId)}>{RARITY_LABELS[item.rarity]}</span></dd></div>
            <div><dt>总数量</dt><dd>{quantity}<small>（每格 {itemStackSize(selectedId)}）</small></dd></div>
            <div><dt>总价值</dt><dd>{item.sellable ? <><Coin value={(item.sellValue ?? 0) * quantity} /><small>单价 {num(item.sellValue ?? 0)}</small></> : '不可出售'}</dd></div>
            <div><dt>总重量</dt><dd>{num(item.weight * quantity)}<small>单重 {num(item.weight)}</small></dd></div>
          </dl>
          <div className="ip-tags">{item.tags?.map(tag => <span key={tag}>{itemTagLabel(tag)}</span>)}</div>
          {(item.secondaryGrant || item.tagGrantId) && <p className="ip-effect">{item.tagGrantId ? `赋予特质：${catalog.tags[item.tagGrantId]?.name ?? item.tagGrantId}` : `${SECONDARY_STAT_LABELS[item.secondaryGrant!.stat]} +${item.secondaryGrant!.amount}`} · 使用后永久生效</p>}
          {(item.foodBuff || item.foodHeal) && <p className="ip-effect">{[
            item.foodBuff && `出发前吃下：${STAT_LABELS[item.foodBuff.stat]} +${item.foodBuff.amount}，整趟冒险有效`,
            item.foodHeal && `吃下恢复 ${item.foodHeal.steps} 档伤势`,
          ].filter(Boolean).join(' · ')}</p>}
        </> : <p className="ip-empty">选择物品查看详情</p>}
      </aside>
    </div>
    <footer className="ip-footer">
      {view.bulk ? <>
        <button className="ip-select-all" onClick={() => update({ picked: picked.length && picked.length === eligible.length ? [] : eligible })}>{picked.length > 0 && picked.length === eligible.length ? '取消全选' : '全选'}{excluded > 0 && `（排除 ${excluded} 种锁定/不可售）`}</button>
        <span>已选 {picked.length} 格 · {selectedCount} 件</span><Coin value={saleValue(pickedQuantitiesMap)} />
        <button className="ip-primary ip-bulk-sell" disabled={!selectedCount} onClick={() => openSale(pickedQuantitiesMap)}>售卖</button>
      </> : <><span className={warehouseSlotsUsed(game) > game.warehouseSlots ? 'ip-warning' : ''}>仓库格子 {warehouseSlotsUsed(game)} / {game.warehouseSlots}</span><span className="ip-feedback" role="status">{message || '仓库不限负重 · 左键物品打开操作菜单'}</span></>}
    </footer>
    </div>}
    {tip && <ItemTooltip id={tip.id} quantity={tip.quantity} x={tip.x} y={tip.y} />}
    {menu && (game.inventory[menu.id] ?? 0) > 0 && !view.bulk && <div className="ip-menu" role="menu" aria-label="物品操作" style={{ left: menu.x, top: menu.y }} onClick={e => e.stopPropagation()}>
      {usableOnPet(menu.id) && <button role="menuitem" onClick={() => { setDialog({ type: 'use', itemId: menu.id, petId: '', basis: useBasis(game, menu.id) }); setMenu(null); }}>使用</button>}
      <button role="menuitem" disabled={!sellable(game, menu.id)} onClick={() => openSale({ [menu.id]: 1 }, { id: menu.id, cellIndex: menu.index })}>{game.lockedItemIds.includes(menu.id) ? '售卖（已锁定）' : catalog.items[menu.id]?.sellable ? '售卖' : '不可出售'}</button>
      <button role="menuitem" onClick={() => { const id = menu.id; if (run(state => toggleItemLock(state, id))) { setMenu(null); setMessage(game.lockedItemIds.includes(id) ? '已解除售卖锁定' : '已锁定，无法出售'); } }}>{game.lockedItemIds.includes(menu.id) ? '解锁' : '锁定'}</button>
    </div>}
    {dialog && dialogValid && <div className="ip-mask" onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); setDialog(null); }
      if (e.key === 'Tab') {
        const buttons = [...(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select') ?? [])];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <div className={`ip-dialog${dialog.type === 'reports' ? ' reports' : ''}`} ref={modal} role="dialog" aria-modal="true" aria-labelledby="inventory-dialog-title">
        <h2 id="inventory-dialog-title">{dialog.type === 'sale' ? '确认售卖' : dialog.type === 'use' ? `使用 ${catalog.items[dialog.itemId]?.name}` : dialog.type === 'discard' ? `丢弃 ${catalog.items[dialog.itemId]?.name}` : '冒险战报'}</h2>
        {dialog.type === 'sale' && <>
          {dialog.singleId && <div className="ip-quantity"><button aria-label="减少售卖数量" disabled={dialog.quantities[dialog.singleId] <= 1} onClick={() => setSaleQuantity(dialog.quantities[dialog.singleId!] - 1)}>−</button><input aria-label="售卖数量" type="number" min={1} max={saleLimit} value={dialog.quantities[dialog.singleId]} onChange={e => setSaleQuantity(Number(e.target.value))} /><button aria-label="增加售卖数量" disabled={dialog.quantities[dialog.singleId] >= saleLimit} onClick={() => setSaleQuantity(dialog.quantities[dialog.singleId!] + 1)}>＋</button><button onClick={() => setSaleQuantity(saleLimit)}>本格全部</button></div>}
          {dialog.singleId && <p className="ip-hint">本格共 {saleLimit} 件。同名的其它格子不会被一起卖出——要卖哪一格就点哪一格。</p>}
          <ul className="ip-sale-lines">{Object.entries(dialog.quantities).map(([id, q]) => <li key={id}><span>{catalog.items[id]?.name} ×{q}</span><Coin value={(catalog.items[id]?.sellValue ?? 0) * q} /></li>)}</ul>
          <p className="ip-sale-total">共 {itemCount(dialog.quantities)} 件，合计 <Coin value={saleValue(dialog.quantities)} /></p>
          {Object.keys(dialog.quantities).some(id => rarityRank(catalog.items[id].rarity) >= rarityRank('epic')) && <p className="ip-warning">包含史诗或更高稀有度物品，请确认取舍。出售后无法撤销。</p>}
        </>}
        {dialog.type === 'use' && <>
          <p className="ip-hint">{catalog.items[dialog.itemId].foodHeal && !catalog.items[dialog.itemId].secondaryGrant && !catalog.items[dialog.itemId].tagGrantId
            ? '选择伙伴，确认后消耗 1 份食物。出门在外的伙伴请在节点上吃背包里的食物。'
            : '选择伙伴，确认后消耗 1 件道具，效果永久绑定。'}{catalog.items[dialog.itemId].secondaryGrant && `次要属性上限 ${secondaryStatCap()}。`}</p>
          <div className="ip-pet-list">{Object.values(game.pets).map(pet => {
            const reason = useBlockReason(pet, dialog.itemId, game);
            return <button key={pet.id} className="ip-pet-choice" data-pet-id={pet.id} aria-pressed={dialog.petId === pet.id} disabled={!!reason} onClick={() => setDialog({ ...dialog, petId: pet.id })}><strong>{pet.name}</strong><span>{usePreview(pet, dialog.itemId)}{reason && ` · ${reason}`}</span></button>;
          })}</div>
        </>}
        {dialog.type === 'discard' && <>
          <p className="ip-warning">丢弃后无法找回，也不会获得货币或经验。这一格最多 {discardLimit} 件，同名的其它格子不受影响。</p>
          <div className="ip-quantity"><label>数量 <input aria-label="丢弃数量" type="number" min={1} max={discardLimit} value={dialog.quantity} onChange={e => setDialog({ ...dialog, quantity: Math.max(1, Math.min(discardLimit, Math.trunc(Number(e.target.value)) || 1)) })} /></label><button onClick={() => setDialog({ ...dialog, quantity: discardLimit })}>本格全部</button></div>
        </>}
        {dialog.type === 'reports' && <div className="ip-reports-body">{game.settlements.length ? reports : <p className="ip-empty">还没有冒险战报。</p>}</div>}
        <div className="ip-dialog-actions"><button onClick={() => setDialog(null)}>{dialog.type === 'reports' ? '关闭战报' : '取消'}</button>{dialog.type !== 'reports' && <button className="ip-primary ip-confirm" disabled={dialog.type === 'use' && (!dialog.petId || !!useBlockReason(game.pets[dialog.petId], dialog.itemId, game))} onClick={commit}>{dialog.type === 'sale' ? '确认售卖' : dialog.type === 'use' ? '确认使用' : '确认丢弃'}</button>}</div>
      </div>
    </div>}
  </div>;
}
