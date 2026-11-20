import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react';
import { useLocal } from '../lib/router';

const MIN = 260;
const MAX = 520;
const DEFAULT = 372;
const clamp = (value: number, max: number) => Math.min(max, Math.max(MIN, value));

export function useStageSidebarResize(enabled: boolean) {
  const [preferred, setPreferred] = useLocal('stage.sidebarWidth', DEFAULT);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const drag = useRef<{ pointer: number; x: number; start: number; width: number } | null>(null);
  const max = clamp(viewport - 380, MAX);
  const width = clamp(liveWidth ?? (Number.isFinite(preferred) ? preferred : DEFAULT), max);

  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (enabled && viewport > 640) return;
    drag.current = null;
    setLiveWidth(null);
  }, [enabled, viewport]);

  const finish = (pointer: number) => {
    const d = drag.current;
    if (d?.pointer !== pointer) return;
    drag.current = null;
    if (d.width !== d.start) setPreferred(d.width);
    setLiveWidth(null);
  };
  const handle: HTMLAttributes<HTMLDivElement> = {
    role: 'separator', tabIndex: 0, 'aria-label': '调整左侧栏宽度', 'aria-orientation': 'vertical',
    'aria-valuemin': MIN, 'aria-valuemax': max, 'aria-valuenow': width,
    onPointerDown(event) {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, x: event.clientX, start: width, width };
      setLiveWidth(width);
    },
    onPointerMove(event) {
      const d = drag.current;
      if (d?.pointer !== event.pointerId) return;
      d.width = clamp(d.start + event.clientX - d.x, max);
      setLiveWidth(d.width);
    },
    onPointerUp: (event) => finish(event.pointerId),
    onPointerCancel: (event) => finish(event.pointerId),
    onLostPointerCapture: (event) => finish(event.pointerId),
    onKeyDown(event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 40 : 16;
      const next = event.key === 'Home' ? MIN : event.key === 'End' ? max : clamp(width + (event.key === 'ArrowLeft' ? -step : step), max);
      if (next !== width) setPreferred(next);
    },
  };
  return { dragging: liveWidth != null, style: { '--stage-side-width': `${width}px` } as CSSProperties, handle };
}
