import { useEffect, useRef } from 'react';
import { catalog } from '../domain/catalog';
import { petSecondaryStat, secondaryStatCap, SECONDARY_STAT_LABELS } from '../domain/engine';
import type { GameState, Pet } from '../domain/types';
import { foodHealPreview, useBlockReason } from './inventoryPanelModel';

function preview(pet: Pet, itemId: string) {
  const item = catalog.items[itemId];
  if (item.tagGrantId) return `永久获得「${catalog.tags[item.tagGrantId]?.name ?? item.tagGrantId}」`;
  if (item.foodHeal && !item.secondaryGrant) return `伤势 ${foodHealPreview(pet, item.foodHeal.steps)}`;
  if (!item.secondaryGrant) return '无法使用';
  const grant = item.secondaryGrant, current = petSecondaryStat(pet, grant.stat);
  const next = Math.min(secondaryStatCap(), current + grant.amount);
  return `${SECONDARY_STAT_LABELS[grant.stat]} ${current} → ${next}${current + grant.amount > secondaryStatCap() ? `（超出 ${current + grant.amount - secondaryStatCap()} 点将浪费）` : ''}`;
}

/** 库存和行前整备共用受益对象选择与确认，实际消耗由各自入口提交。 */
export function ItemUseDialog({ game, itemId, petId, onSelect, onConfirm, onCancel, canConfirm = true }: {
  game: GameState; itemId: string; petId: string; onSelect: (id: string) => void;
  onConfirm: () => void; onCancel: () => void; canConfirm?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const item = catalog.items[itemId];
  useEffect(() => { root.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true }); }, [itemId]);
  return <>
    <p className="ip-hint">{item.foodHeal && !item.secondaryGrant && !item.tagGrantId
      ? '选择伙伴，确认后消耗 1 份食物。出门在外的伙伴请用探险背包里的食物。'
      : '选择伙伴，确认后消耗 1 件道具，效果永久绑定。'}{item.secondaryGrant && `次要属性上限 ${secondaryStatCap()}。`}</p>
    <div className="ip-pet-list" ref={root}>{Object.values(game.pets).map(pet => {
      const reason = useBlockReason(pet, itemId, game);
      return <button key={pet.id} className="ip-pet-choice" data-pet-id={pet.id} aria-pressed={petId === pet.id} disabled={!!reason} onClick={() => onSelect(pet.id)}><strong>{pet.name}</strong><span>{preview(pet, itemId)}{reason && ` · ${reason}`}</span></button>;
    })}</div>
    <div className="ip-dialog-actions"><button onClick={onCancel}>取消</button><button className="ip-primary ip-confirm" disabled={!canConfirm || !petId || !!useBlockReason(game.pets[petId], itemId, game)} onClick={onConfirm}>确认使用</button></div>
  </>;
}
