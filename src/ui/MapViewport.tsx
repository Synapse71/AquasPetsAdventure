import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function mapViewportGeometry(width: number, height: number, ratio: number, center: { x: number; y: number }) {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9;
  const contentWidth = Math.max(width, height * safeRatio);
  const contentHeight = contentWidth / safeRatio;
  return {
    width: contentWidth, height: contentHeight,
    left: Math.max(0, Math.min(contentWidth - width, contentWidth * center.x / 100 - width / 2)),
    top: Math.max(0, Math.min(contentHeight - height, contentHeight * center.y / 100 - height / 2)),
  };
}

/** 固定视窗内移动地图；pointer capture 仅在超过拖拽阈值后启用，以保留节点点击。 */
export function MapViewport({ mapId, ratio, center = { x: 50, y: 50 }, onPan, children }: {
  mapId: string; ratio: number; center?: { x: number; y: number }; onPan: () => void; children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | undefined>(undefined);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [size, setSize] = useState({ width: 600, height: 600 / ratio });
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    let frame = 0;
    const resize = () => {
      if (!el.clientWidth || !el.clientHeight) return;
      const next = mapViewportGeometry(el.clientWidth, el.clientHeight, ratio, center);
      setSize({ width: next.width, height: next.height });
      el.scrollLeft = next.left;
      el.scrollTop = next.top;
      // Content dimensions are committed on the next render.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { el.scrollLeft = next.left; el.scrollTop = next.top; });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [mapId, ratio, center.x, center.y]);
  return <div ref={host} className={`ap-map-viewport${dragging ? ' dragging' : ''}`} tabIndex={0}
    aria-label="地图视窗，可拖拽移动，或使用方向键平移"
    onDragStart={event => event.preventDefault()}
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary) return;
      suppressClick.current = false;
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop, moved: false };
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 5) return;
      if (!start.moved) { start.moved = true; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); onPan(); }
      suppressClick.current = true;
      event.preventDefault();
      event.currentTarget.scrollLeft = start.left - dx;
      event.currentTarget.scrollTop = start.top - dy;
    }}
    onPointerUp={event => {
      if (drag.current?.id !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      drag.current = undefined; setDragging(false);
    }}
    onPointerCancel={() => { drag.current = undefined; setDragging(false); }}
    onLostPointerCapture={() => { drag.current = undefined; setDragging(false); }}
    onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
    onKeyDown={event => {
      const delta = { ArrowUp: [0, -40], ArrowDown: [0, 40], ArrowLeft: [-40, 0], ArrowRight: [40, 0] }[event.key];
      if (!delta || event.target !== event.currentTarget) return;
      event.preventDefault(); onPan();
      event.currentTarget.scrollLeft += delta[0]; event.currentTarget.scrollTop += delta[1];
    }}>
    <div className="ap-map-surface" style={size}>{children}</div>
  </div>;
}
