import { useEffect, useMemo, useState } from 'react';
import { catalog } from '../domain/catalog';
import { addInventory, cargoSlotCapacity, confirmExtractionPlan, GameRuleError, inventorySlots, inventoryWeight, itemStackSize, pendingFirstExtractionRewards } from '../domain/engine';
import type { Expedition, GameState, Inventory, Settlement } from '../domain/types';
import { AdventureItems } from './AdventureItems';
import { changeQuantity, extractionBasis, extractionPlan, isInventory, subtract } from './adventureModel';
import { itemCount, saleValue } from './inventoryPanelModel';
import { useUIState } from './uiState';

interface Draft { basis: string; keep: Inventory; discard: Inventory; confirming: boolean }
const validDraft = (v: unknown): v is Draft => !!v && typeof v === 'object' && 'basis' in v && typeof v.basis === 'string' && 'keep' in v && isInventory(v.keep) && 'discard' in v && isInventory(v.discard) && 'confirming' in v && typeof v.confirming === 'boolean';
export function ExtractionView({ game, expedition, run, onFinished }: { game: GameState; expedition: Expedition; run: (action: (s: GameState) => GameState) => boolean; onFinished: (report: Settlement) => void }) {
  const basis = extractionBasis(game, expedition.id);
  const [saved, setDraft] = useUIState<Draft>(`extraction-${expedition.id}`, { basis, keep: {}, discard: {}, confirming: false }, validDraft);
  const [message, setMessage] = useState('');
  let stale = saved.basis !== basis;
  try { extractionPlan(expedition.cargo, saved.keep, saved.discard); } catch { stale = true; }
  const draft = stale ? { basis, keep: {}, discard: {}, confirming: false } : saved;
  useEffect(() => { if (stale) { setDraft({ basis, keep: {}, discard: {}, confirming: false }); setMessage('背包、仓库或队伍状态已变化，已重新载入本轮物品，请重新整理。'); } }, [stale, basis, setDraft]);
  const plan = extractionPlan(expedition.cargo, draft.keep, draft.discard);
  const first = pendingFirstExtractionRewards(game, expedition);
  const previewInventory = addInventory(game.inventory, draft.keep);
  const weight = inventoryWeight(draft.keep);
  const preview = useMemo(() => {
    try { return { report: confirmExtractionPlan(game, expedition.id, plan, 0).settlements[0], error: '' }; }
    catch (error) { return { error: error instanceof Error ? error.message : '无法撤离' }; }
  }, [basis, JSON.stringify(plan)]);
  const transfer = (id: string, q: number, intoWarehouse: boolean) => {
    const amount = Math.min(q, intoWarehouse ? plan.sell[id] ?? 0 : draft.keep[id] ?? 0);
    if (!amount) return;
    const keep = changeQuantity(draft.keep, id, intoWarehouse ? amount : -amount);
    if (intoWarehouse && inventorySlots(addInventory(addInventory(game.inventory, keep), first)) > game.warehouseSlots) { setMessage('仓库空间不足（已预留首次撤离奖励）。'); return; }
    setDraft({ ...draft, keep, confirming: false }); setMessage('');
  };
  const commit = () => {
    let report: Settlement | undefined;
    if (run(state => {
      if (extractionBasis(state, expedition.id) !== draft.basis) throw new GameRuleError('撤离清单已变化，请重新确认。');
      const next = confirmExtractionPlan(state, expedition.id, plan);
      report = next.settlements[0]; return next;
    }) && report) onFinished(report);
  };
  return <>
    <div className="ap-body ap-extraction">
      <div className="ap-transfer">
        <section className="ap-bag-col"><h3>探险背包 <span>{inventorySlots(plan.sell)} / {cargoSlotCapacity(game,expedition)} 格</span></h3><div className="ap-loadout-tools"><span className="ap-muted">未放入仓库的将就地售卖</span></div><AdventureItems inventory={plan.sell} slots={cargoSlotCapacity(game,expedition)} room={id => { const stack=itemStackSize(id),held=(previewInventory[id]??0)+(first[id]??0); return (held%stack?stack-held%stack:0)+Math.max(0,game.warehouseSlots-inventorySlots(addInventory(previewInventory,first)))*stack; }} onPick={(id, q) => transfer(id, q, true)} empty="已全部安排去向" /></section>
        <section><h3>仓库 <span>{inventorySlots(addInventory(previewInventory, first))} / {game.warehouseSlots} 格</span></h3><div className="ap-loadout-tools"><span className="ap-muted">带边框的是本次入库，可取回</span></div><AdventureItems inventory={previewInventory} slots={game.warehouseSlots} onPick={(id, q) => transfer(id, q, false)} movable={draft.keep} empty="点击左侧物品，移入仓库" /></section>
      </div>
      <div className="ap-inline-actions"><button onClick={() => {
        const keep = subtract(expedition.cargo, draft.discard);
        if (inventorySlots(addInventory(addInventory(game.inventory, keep), first)) > game.warehouseSlots) { setMessage('仓库放不下全部物品，请手动选择。'); return; }
        setDraft({ ...draft, keep, confirming: false }); setMessage('');
      }}>全部入库</button><button onClick={() => setDraft({ ...draft, keep: {}, confirming: false })}>全部取回</button><span>本次入库 {itemCount(draft.keep)} 件 · 重量 {weight}（撤离不限重）</span></div>
      {Object.entries(plan.sell).filter(([id]) => !catalog.items[id]?.sellable).map(([id, q]) => <div className="ap-unsellable" key={id}><span>{catalog.items[id].name} ×{q} 不可出售，必须保留或明确丢弃。</span><button onClick={() => transfer(id, q, true)}>保留</button><button className="ap-danger" onClick={() => setDraft({ ...draft, discard: changeQuantity(draft.discard, id, q), confirming: false })}>标记丢弃</button></div>)}
      {!!itemCount(draft.discard) && <div className="ap-warning">待丢弃：{Object.entries(draft.discard).map(([id, q]) => `${catalog.items[id].name} ×${q}`).join('、')} <button onClick={() => setDraft({ ...draft, discard: {}, confirming: false })}>撤销丢弃</button></div>}
      {!!itemCount(first) && <div className="ap-first-reward"><strong>首次撤离奖励 · 已预留仓库空间</strong><AdventureItems inventory={first} /></div>}
      {(message || preview.error) && <p role="status" className="ap-warning">{message || preview.error}</p>}
    </div>
    <footer className="ap-footer"><span>预计出售 +{saleValue(plan.sell)}　·　每只伙伴 +{preview.report?.xpAward ?? '—'} XP</span><button className="ap-primary" disabled={!!preview.error} onClick={() => itemCount(plan.sell) || itemCount(plan.discard) ? setDraft({ ...draft, confirming: true }) : commit()}>确认撤离</button></footer>
    {draft.confirming && <div className="ap-mask"><section className="ap-dialog" role="alertdialog" aria-label="确认撤离清单"><h2>确认撤离</h2><p>以下操作一并完成，确认后不可撤销。</p><div className="ap-sale-list">{Object.entries(plan.sell).map(([id, q]) => <p key={id}><span>{catalog.items[id].name} ×{q}</span><b>+{(catalog.items[id].sellValue ?? 0) * q}</b></p>)}{!!itemCount(draft.discard) && <p className="ap-warning">丢弃：{Object.entries(draft.discard).map(([id, q]) => `${catalog.items[id].name} ×${q}`).join('、')}</p>}</div><p><strong>保留 {itemCount(plan.keep)} 件 · 出售合计 +{saleValue(plan.sell)}</strong></p><div className="ap-dialog-actions"><button onClick={() => setDraft({ ...draft, confirming: false })}>返回整理</button><button className="ap-primary" disabled={!!preview.error} onClick={commit}>确认撤离</button></div></section></div>}
  </>;
}
