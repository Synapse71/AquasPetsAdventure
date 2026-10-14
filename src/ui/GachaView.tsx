import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { catalog } from '../domain/catalog';
import { claimGachaPending, drawGacha, gachaStatus } from '../domain/gacha';
import { RARITIES, RARITY_LABELS, type Rarity } from '../domain/rarity';
import type { GachaPrize, GameState, Inventory } from '../domain/types';
import { AdventureItems } from './AdventureItems';
import { gachaClip, gachaEggStyle, gachaIntro, gachaPrizeFill, gachaTier, GACHA_CLIP_MS, GACHA_IDLE_IMAGE, GACHA_STAGE_MS, type GachaStage } from './gachaModel';
import { lootIconUrl } from './lootIcons';
import coinIcon from '../../assets/ui-prototype/icons/coin.png';
import xpIcon from '../../assets/ui-prototype/icons/xp.png';
import './gachaView.css';

type Run = (action: (state: GameState) => GameState) => boolean;

// 已经做好视频的档位。所有 <video> 一开始就挂着并预加载：抽之前不知道会开出哪一档，
// 点下去才创建 <video> 的话解码器要现开，中间几帧画不出来就是一下闪白（宝箱踩过的坑）。
const CLIPS = RARITIES.flatMap(tier => { const fx = gachaClip(tier); return fx ? [{ tier, ...fx }] : []; });

function prizeIcon(prize: GachaPrize): string | undefined {
  return prize.kind === 'item' ? lootIconUrl(prize.itemId!) : prize.kind === 'currency' ? coinIcon : xpIcon;
}

function PrizeCard({ prize, game }: { prize: GachaPrize; game: GameState }) {
  // 道具、金币、经验用同一种方框：大小和图标尺寸一致，只有底色不同（道具按稀有度，和仓库格子同色）。
  const icon = <span className={`gacha-result-icon ${prize.kind}`} style={{ background: gachaPrizeFill(prize) }}>{prizeIcon(prize) && <img src={prizeIcon(prize)} alt="" />}</span>;
  if (prize.kind === 'item') {
    const item = catalog.items[prize.itemId!];
    return <div className="gacha-result" data-testid="gacha-result">
      {icon}
      <div><small className={`gacha-rarity-${prize.rarity}`}>{RARITY_LABELS[prize.rarity ?? 'common']}</small><strong>{item?.name ?? prize.itemId}{prize.amount > 1 ? ` ×${prize.amount}` : ''}</strong></div>
    </div>;
  }
  const pet = Object.values(game.pets)[0];
  return <div className="gacha-result" data-testid="gacha-result">
    {icon}
    <div><small>{prize.kind === 'currency' ? '金币' : `${pet?.name ?? '伙伴'}获得经验`}</small><strong>+{prize.amount}</strong></div>
  </div>;
}

/** 开壳后从扭蛋里冒出来的奖品小图标。方框样式照搬开箱拾取的战利品卡：灰边、内衬一层带圆角的底色。 */
function PrizePop({ prize }: { prize: GachaPrize }) {
  return <span className={`gacha-prize-pop ${prize.kind}`} style={{ '--item-color': gachaPrizeFill(prize) } as CSSProperties} aria-hidden="true"><span />{prizeIcon(prize) && <img src={prizeIcon(prize)} alt="" />}</span>;
}

export function GachaView({ game, now, run }: { game: GameState; now: number; run: Run }) {
  const status = gachaStatus(game, now);
  const [stage, setStage] = useState<GachaStage>('idle');
  const [tier, setTier] = useState<Rarity>();
  // 抽之前的待领取清单。奖励在点按钮时就已入账，仓库放不下的道具会立刻进待领取；
  // 演出没播完就亮出「待领取」等于剧透，所以演出期间先显示抽之前的样子，和抽奖结果一起揭晓。
  const [pendingBefore, setPendingBefore] = useState<Inventory>();
  const videos = useRef(new Map<Rarity, HTMLVideoElement>());
  const prize = game.gacha.lastPrize;
  const fx = tier ? CLIPS.find(entry => entry.tier === tier) : undefined;

  // 奖励在点按钮那一刻就已经入账，动画只是演出：关面板、跳过都不影响结果。
  useEffect(() => {
    if (stage === 'idle' || stage === 'revealed') return;
    if (stage === 'playing') {
      // 视频没能播完（解码失败、被策略挡住）时靠它收尾，不会卡在半路。
      const timer = window.setTimeout(() => setStage('revealed'), GACHA_CLIP_MS);
      return () => window.clearTimeout(timer);
    }
    const next: Record<'turning' | 'dropping' | 'opening', GachaStage> = { turning: 'dropping', dropping: 'opening', opening: 'revealed' };
    const timer = window.setTimeout(() => setStage(next[stage]), GACHA_STAGE_MS[stage]);
    return () => window.clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'playing' || !tier) return;
    const video = videos.current.get(tier);
    if (!video) return;
    video.currentTime = 0;
    video.play().catch(() => setStage('revealed'));
  }, [stage, tier]);

  if (!status) return <div className="ap-body"><p className="ap-muted">抽奖尚未配置。</p></div>;
  const animating = stage !== 'idle' && stage !== 'revealed';
  const draw = () => {
    let drawn: GachaPrize | undefined;
    setPendingBefore(status.pending);
    if (!run(state => { const next = drawGacha(state, Date.now()); drawn = next.gacha.lastPrize; return next; }) || !drawn) return;
    const nextTier = gachaTier(drawn);
    setTier(nextTier);
    setStage(CLIPS.some(entry => entry.tier === nextTier) ? 'playing' : 'turning');
  };
  const pending = animating && pendingBefore ? pendingBefore : status.pending;
  const pendingCount = Object.values(pending).reduce((sum, value) => sum + value, 0);
  const egg = prize ? gachaEggStyle(prize) : undefined;
  const buttonLabel = status.freeLeft > 0 ? `今日免费 · 剩 ${status.freeLeft} 次` : `再抽一次 · ${status.nextPrice} 金币`;
  const showVideo = Boolean(fx) && (stage === 'playing' || stage === 'revealed');

  return <>
    <div className="ap-body gacha-body" data-testid="gacha-view">
      <button type="button" className={`gacha-stage stage-${stage}${GACHA_IDLE_IMAGE ? ' with-art' : ''}`} aria-label={animating ? '跳过开蛋动画' : '扭蛋机'} disabled={!animating} onClick={() => setStage('revealed')}
        style={egg ? { '--egg': egg.color, '--glow': egg.glow } as CSSProperties : undefined}>
        {GACHA_IDLE_IMAGE
          ? <img className="gacha-machine-art" src={GACHA_IDLE_IMAGE} alt="" hidden={showVideo} />
          : <span className="gacha-machine" aria-hidden="true">
            <span className="gacha-dome">{['#f3c63c', '#74b9f0', '#a8dc82', '#b98bee', '#f08a86', '#7fd1c7', '#e3e3e3'].map((color, index) => <i key={index} style={{ '--ball': color, '--i': index } as CSSProperties} />)}</span>
            <span className="gacha-base"><i className="gacha-knob" /><i className="gacha-chute" /></span>
          </span>}
        {CLIPS.map(entry => <span key={entry.tier} className="gacha-fx" data-tier={entry.tier} hidden={!showVideo || fx?.tier !== entry.tier} aria-hidden="true">
          <img src={entry.still} alt="" />
          <video ref={element => { if (element) videos.current.set(entry.tier, element); else videos.current.delete(entry.tier); }}
            src={entry.clip} poster={GACHA_IDLE_IMAGE} muted playsInline preload="auto"
            hidden={stage === 'revealed'} onEnded={() => setStage(current => current === 'playing' ? 'revealed' : current)} />
        </span>)}
        {!showVideo && stage !== 'idle' && egg && <span className="gacha-egg" aria-hidden="true"><b className="glow" />{Array.from({ length: egg.sparks }, (_, index) => <em key={index} style={{ '--a': `${(360 / egg.sparks) * index}deg` } as CSSProperties} />)}<i className="top" /><i className="bottom" /></span>}
        {showVideo && stage === 'revealed' && prize && <PrizePop prize={prize} />}
      </button>
      <div className="gacha-side">
        <p className="ap-kicker">每日扭蛋</p>
        <h2>{catalog.gachas.daily?.name ?? '扭蛋'}</h2>
        <p className="ap-description">{gachaIntro(catalog.gachas.daily)}</p>
        {stage === 'revealed' && prize ? <PrizeCard prize={prize} game={game} /> : <div className="gacha-result placeholder">{animating ? '开蛋中…（点击画面跳过）' : '投币，转动把手'}</div>}
        {pendingCount > 0 && <section className="gacha-pending" data-testid="gacha-pending">
          <div className="ap-sec-h">待领取 · {pendingCount} 件<span className="ap-muted">仓库放不下的道具会先放在这里</span></div>
          <AdventureItems inventory={pending} />
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
