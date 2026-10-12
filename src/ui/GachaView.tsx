import { useEffect, useState, type CSSProperties } from 'react';
import { catalog } from '../domain/catalog';
import { claimGachaPending, drawGacha, gachaStatus } from '../domain/gacha';
import { RARITY_LABELS } from '../domain/rarity';
import type { GachaPrize, GameState } from '../domain/types';
import { AdventureItems } from './AdventureItems';
import { gachaEggStyle, GACHA_STAGE_MS, type GachaStage } from './gachaModel';
import coinIcon from '../../assets/ui-prototype/icons/coin.png';
import './gachaView.css';

type Run = (action: (state: GameState) => GameState) => boolean;

function PrizeCard({ prize, game }: { prize: GachaPrize; game: GameState }) {
  if (prize.kind === 'item') {
    const item = catalog.items[prize.itemId!];
    return <div className="gacha-result" data-testid="gacha-result">
      <AdventureItems inventory={{ [prize.itemId!]: prize.amount }} />
      <div><small className={`gacha-rarity-${prize.rarity}`}>{RARITY_LABELS[prize.rarity ?? 'common']}</small><strong>{item?.name ?? prize.itemId}</strong></div>
    </div>;
  }
  const pet = Object.values(game.pets)[0];
  return <div className="gacha-result" data-testid="gacha-result">
    <span className={`gacha-result-icon ${prize.kind}`}>{prize.kind === 'currency' ? <img src={coinIcon} alt="" /> : 'EXP'}</span>
    <div><small>{prize.kind === 'currency' ? '金币' : `${pet?.name ?? '伙伴'}获得经验`}</small><strong>+{prize.amount}</strong></div>
  </div>;
}

export function GachaView({ game, now, run }: { game: GameState; now: number; run: Run }) {
  const status = gachaStatus(game, now);
  const [stage, setStage] = useState<GachaStage>('idle');
  const prize = game.gacha.lastPrize;

  // 奖励在点按钮那一刻就已经入账，动画只是演出：关面板、跳过都不影响结果。
  useEffect(() => {
    if (stage === 'idle' || stage === 'revealed') return;
    const next: Record<'turning' | 'dropping' | 'opening', GachaStage> = { turning: 'dropping', dropping: 'opening', opening: 'revealed' };
    const timer = window.setTimeout(() => setStage(next[stage]), GACHA_STAGE_MS[stage]);
    return () => window.clearTimeout(timer);
  }, [stage]);

  if (!status) return <div className="ap-body"><p className="ap-muted">抽奖尚未配置。</p></div>;
  const animating = stage !== 'idle' && stage !== 'revealed';
  const draw = () => { if (run(state => drawGacha(state, Date.now()))) setStage('turning'); };
  const pendingCount = Object.values(status.pending).reduce((sum, value) => sum + value, 0);
  const egg = prize ? gachaEggStyle(prize) : undefined;
  const buttonLabel = status.freeLeft > 0 ? `今日免费 · 剩 ${status.freeLeft} 次` : `再抽一次 · ${status.nextPrice} 金币`;

  return <>
    <div className="ap-body gacha-body" data-testid="gacha-view">
      <button type="button" className={`gacha-stage stage-${stage}`} aria-label={animating ? '跳过开蛋动画' : '扭蛋机'} disabled={!animating} onClick={() => setStage('revealed')}
        style={egg ? { '--egg': egg.color, '--glow': egg.glow } as CSSProperties : undefined}>
        <span className="gacha-machine" aria-hidden="true">
          <span className="gacha-dome">{['#f3c63c', '#74b9f0', '#a8dc82', '#b98bee', '#f08a86', '#7fd1c7', '#e3e3e3'].map((color, index) => <i key={index} style={{ '--ball': color, '--i': index } as CSSProperties} />)}</span>
          <span className="gacha-base"><i className="gacha-knob" /><i className="gacha-chute" /></span>
        </span>
        {stage !== 'idle' && egg && <span className="gacha-egg" aria-hidden="true"><b className="glow" />{Array.from({ length: egg.sparks }, (_, index) => <em key={index} style={{ '--a': `${(360 / egg.sparks) * index}deg` } as CSSProperties} />)}<i className="top" /><i className="bottom" /></span>}
      </button>
      <div className="gacha-side">
        <p className="ap-kicker">每日扭蛋</p>
        <h2>{catalog.gachas.daily?.name ?? '扭蛋'}</h2>
        <p className="ap-description">每天免费扭一次，能开出金币、经验或稀有道具。之后可以花金币继续扭，价格每次翻倍，每天凌晨重置。</p>
        {stage === 'revealed' && prize ? <PrizeCard prize={prize} game={game} /> : <div className="gacha-result placeholder">{animating ? '开蛋中…' : '投币，转动把手'}</div>}
        {pendingCount > 0 && <section className="gacha-pending" data-testid="gacha-pending">
          <div className="ap-sec-h">待领取 · {pendingCount} 件<span className="ap-muted">仓库放不下的道具会先放在这里</span></div>
          <AdventureItems inventory={status.pending} />
          <button type="button" onClick={() => run(state => claimGachaPending(state, Date.now()))}>领取到仓库</button>
        </section>}
      </div>
    </div>
    <footer className="ap-footer">
      <span>{status.freeLeft > 0 ? '今天的免费次数还没用' : `今天已付费 ${status.paidCount} 次 · 持有 ${game.currency} 金币`}</span>
      <button className="ap-primary" data-testid="gacha-draw" disabled={animating || !status.canDraw} onClick={draw}>{buttonLabel}</button>
    </footer>
  </>;
}
