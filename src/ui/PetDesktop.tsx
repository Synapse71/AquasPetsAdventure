import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { computeLayout, petMetrics, type Layout } from '../../desktop/geometry.mjs';
import './desktopBridge';
import { ARRIVAL_CLIPS, isArrival, PetAnimator, type Pose } from './petAnimation';
import { petFrameOffsetX } from './petFrameAlignment';
import { useUIState } from './uiState';
import spriteManifest from '../../public/pet-sprites/manifest.json';
import './petDesktop.css';

export type PanelId = 'pets' | 'inventory' | 'adventure' | 'codex' | 'settings';
export const PET_MENUS: { id: PanelId; label: string; icon: string }[] = [
  { id: 'pets', label: '状态', icon: 'status' }, { id: 'inventory', label: '库存', icon: 'storage' },
  { id: 'adventure', label: '行动', icon: 'flag' }, { id: 'codex', label: '图鉴', icon: 'codex' },
  { id: 'settings', label: '设置', icon: 'gear' },
];
const icons = import.meta.glob<string>('../../assets/ui-prototype/icons/{status,storage,flag,codex,gear,bulb,coin}.png', { eager: true, query: '?url', import: 'default' });
const standing = `${import.meta.env.BASE_URL}pet-sprites/standing.png`;
export const menuIcon = (icon: string) => icons[`../../assets/ui-prototype/icons/${icon}.png`];
const rectStyle = (rect: { x: number; y: number; width: number; height: number }): CSSProperties => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });
const isPosition = (v: unknown): v is { x: number; y: number } => !!v && typeof v === 'object' && 'x' in v && 'y' in v && Number.isFinite(v.x) && Number.isFinite(v.y);
type Sheet = { file: string; frames: number; width: number; height: number; columns: number; fps: number; loop: boolean };
export function PetDesktop({ name, activePanel, onOpen, onClose, pending, onPending, travel, children }: {
  name: string; activePanel: PanelId | null; onOpen: (panel: PanelId) => void; onClose: () => void;
  pending: boolean; onPending: () => void;
  travel?: { label: string; remaining: string; progress: number; departureId?: string };
  children: ReactNode;
}) {
  const bridge = window.desktopPet;
  const [menu, setMenu] = useState(false);
  const [canvasSize, setCanvasSize] = useState(300);
  const metrics = petMetrics(canvasSize);
  const [position, setPosition] = useUIState('pet-position', { x: window.innerWidth - 340, y: window.innerHeight - 410 }, isPosition);
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
  const [nativeLayout, setNativeLayout] = useState<Layout>();
  const fallback = computeLayout(position, viewport, activePanel, canvasSize);
  // Browser preview uses work-area coordinates. Native uses a stable panel envelope.
  const layout = nativeLayout ?? { ...fallback, pet: { ...fallback.pet, x: fallback.position.x, y: fallback.position.y }, panel: fallback.panel && { ...fallback.panel, x: fallback.panel.x + fallback.bounds.x, y: fallback.panel.y + fallback.bounds.y } };
  const canvas = useRef<HTMLCanvasElement>(null);
  const animator = useRef(new PetAnimator(Date.now()));
  const live = useRef({ travel: !!travel, departureId: travel?.departureId, menu });
  live.current = { travel: !!travel, departureId: travel?.departureId, menu };
  const drag = useRef<{ x: number; y: number; petX: number; petY: number; moved: boolean; pointerId: number } | null>(null);
  const [assetError, setAssetError] = useState(false);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const interact = () => animator.current.interact(Date.now());

  useEffect(() => {
    const resize = () => setViewport({ x: 0, y: 0, width: innerWidth, height: innerHeight });
    const close = () => { setMenu(false); closeRef.current(); };
    window.addEventListener('resize', resize);
    window.addEventListener('blur', close);
    const offClose = bridge?.onClosePanels(close);
    const accept = (state: Awaited<ReturnType<NonNullable<typeof bridge>['getState']>>) => {
      if (state) { setNativeLayout(state.layout); setCanvasSize(state.canvas); }
    };
    const offLayout = bridge?.onLayout(accept);
    void bridge?.getState().then(accept);
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('blur', close); offClose?.(); offLayout?.(); };
  }, [bridge]);
  useEffect(() => {
    setMenu(false);
    void bridge?.setPanel(activePanel);
  }, [activePanel, bridge]);

  useEffect(() => {
    let stopped = false, raf = 0, lastKey = '';
    const images = new Map<string, HTMLImageElement>();
    const manifest: Record<string, Sheet> = spriteManifest;
    const context = canvas.current?.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    const load = (src: string) => {
      let image = images.get(src);
      if (!image) { image = new Image(); image.src = src; image.onerror = () => { if (!stopped) setAssetError(true); }; images.set(src, image); }
      return image;
    };
    load(standing);
    // Warm the transition sheets before dispatch; no change to the source art.
    load(`${import.meta.env.BASE_URL}pet-sprites/${manifest['start-explore'].file}`);
    load(`${import.meta.env.BASE_URL}pet-sprites/${manifest.walk.file}`);
    for (const clip of ARRIVAL_CLIPS) load(`${import.meta.env.BASE_URL}pet-sprites/${manifest[clip].file}`);
    function render() {
      if (stopped || !context) return;
      const now = Date.now();
      const pose: Pose = animator.current.update(now, live.current.travel, live.current.menu, live.current.departureId);
      const sheet = manifest[pose];
      const source = sheet ? `${import.meta.env.BASE_URL}pet-sprites/${sheet.file}` : standing;
      const image = load(source);
      // A cold image load must not consume the beginning of either transition.
      if ((pose === 'start-explore' || isArrival(pose)) && !image.complete) animator.current.since = now;
      const frame = animator.current.frame(now);
      const key = `${pose}:${frame}:${image.complete}`;
      if (image.complete && image.naturalWidth && key !== lastKey) {
        const offsetX = petFrameOffsetX(pose, frame);
        context.clearRect(0, 0, 300, 282);
        if (sheet) context.drawImage(image, frame % sheet.columns * sheet.width, Math.floor(frame / sheet.columns) * sheet.height, sheet.width, sheet.height, offsetX, 0, 300, 282);
        else context.drawImage(image, 0, 0, 300, 282);
        canvas.current?.setAttribute('data-pose', pose);
        canvas.current?.setAttribute('data-frame', String(frame));
        canvas.current?.setAttribute('data-offset-x', String(offsetX));
        lastKey = key;
      }
      raf = requestAnimationFrame(render);
    }
    render();
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, []);

  const hitPet = (x: number, y: number) => {
    const element = canvas.current;
    if (!element) return false;
    const bounds = element.getBoundingClientRect();
    const px = Math.floor((x - bounds.left) / bounds.width * 300), py = Math.floor((y - bounds.top) / bounds.height * 282);
    if (px < 0 || py < 0 || px >= 300 || py >= 282) return false;
    return (element.getContext('2d')?.getImageData(px, py, 1, 1).data[3] ?? 0) > 20;
  };
  useEffect(() => {
    if (!bridge) return;
    // The reserved (invisible) panel area must be click-through even on startup.
    let ignored = true;
    bridge.setIgnoreMouse(true);
    const move = (event: PointerEvent) => {
      const ui = (event.target as Element).closest('[data-desktop-ui]');
      const next = !drag.current && !ui && !hitPet(event.clientX, event.clientY);
      if (next !== ignored) { ignored = next; bridge.setIgnoreMouse(next); }
    };
    window.addEventListener('pointermove', move);
    return () => { window.removeEventListener('pointermove', move); bridge.setIgnoreMouse(false); };
  }, [bridge]);
  const open = (panel: PanelId) => { interact(); setMenu(false); onOpen(panel); };

  return <div className="pet-client" onPointerDown={event => {
    if (!(event.target as Element).closest('[data-desktop-ui], .pet-hit')) { setMenu(false); onClose(); }
    else interact();
  }} onKeyDown={event => { interact(); if (event.key === 'Escape') { setMenu(false); onClose(); } }}>
    <div className="pet-anchor" style={{ ...rectStyle(layout.pet), '--canvas': `${canvasSize}px`, '--bubble': `${metrics.bubble}px`, '--menu-width': `${metrics.menuWidth}px`, '--menu-gap': `${metrics.gap}px` } as CSSProperties}>
      {travel && menu && <div className="pet-travel" aria-live="off">
        <div><span>{travel.label}</span><time>{travel.remaining}</time></div>
        <div className="pet-travel-track"><i style={{ width: `${Math.max(0, Math.min(1, travel.progress)) * 100}%` }} /></div>
      </div>}
      <button className="pet-hit" aria-label={`点击${name}展开功能菜单`} aria-expanded={menu}
        onPointerDown={event => {
          if (event.button !== 0 || !hitPet(event.clientX, event.clientY)) return;
          interact();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.screenX, y: event.screenY, petX: fallback.position.x, petY: fallback.position.y, moved: false, pointerId: event.pointerId };
          bridge?.startDrag({ x: event.screenX, y: event.screenY });
        }} onPointerMove={event => {
          const start = drag.current;
          if (!start) return;
          const dx = event.screenX - start.x, dy = event.screenY - start.y;
          if (!start.moved && Math.hypot(dx, dy) > 4) start.moved = true;
          if (start.moved && bridge) bridge.dragTo({ x: event.screenX, y: event.screenY });
          if (start.moved && !bridge) setPosition({ x: start.petX + dx, y: start.petY + dy });
        }} onPointerUp={event => {
          const start = drag.current;
          if (!start) return;
          drag.current = null; bridge?.endDrag();
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (!start.moved) { interact(); if (activePanel) onClose(); else setMenu(value => !value); }
        }} onLostPointerCapture={() => { drag.current = null; bridge?.endDrag(); }}
        onClick={event => { if (event.detail === 0) { interact(); if (activePanel) onClose(); else setMenu(value => !value); } }}>
        <canvas ref={canvas} width={300} height={282} aria-label={`${name}桌宠`} />
      </button>
      {pending && <button className="pet-bulb" data-desktop-ui aria-label="处理待办事项" title="处理待办事项" onClick={() => { interact(); setMenu(false); onPending(); }}><img src={menuIcon('bulb')} alt="" /></button>}
      <nav className={`pet-bubbles ${menu ? 'open' : ''}`} aria-label="宠物功能" aria-hidden={!menu}>
        {PET_MENUS.map((entry, index) => <button key={entry.id} data-desktop-ui title={entry.label} aria-label={entry.label} tabIndex={menu ? 0 : -1}
          style={{ '--i': index } as CSSProperties} onClick={() => open(entry.id)}><img src={menuIcon(entry.icon)} alt="" /></button>)}
      </nav>
      {assetError && <small className="pet-asset-error">动画资源加载失败，请重新构建素材</small>}
    </div>
    <div className="pet-panel-host" data-desktop-ui style={layout.panel ? rectStyle(layout.panel) : undefined} hidden={!activePanel}>{children}</div>
  </div>;
}
