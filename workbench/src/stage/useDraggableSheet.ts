import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocal } from '../lib/router';

/** 长按标题 280ms 拖动；捕获指针，跨 iframe 也不丢失；位置限制在舞台内。 */
export function useDraggableSheet(enabled: boolean) {
  const ref = useRef<HTMLElement>(null);
  const [position, setPosition] = useLocal<{ x: number; y: number } | null>('stage.score.position', null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number; active: boolean; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clamp = (x: number, y: number) => {
    const el = ref.current, parent = el?.offsetParent as HTMLElement | null;
    return { x: Math.max(0, Math.min(x, (parent?.clientWidth || 0) - (el?.offsetWidth || 0))), y: Math.max(0, Math.min(y, (parent?.clientHeight || 0) - (el?.offsetHeight || 0))) };
  };
  const latest = useRef({ position, setPosition });
  latest.current = { position, setPosition };
  useLayoutEffect(() => {
    const el = ref.current, parent = el?.offsetParent;
    if (!el || !parent) return;
    const observer = new ResizeObserver(() => {
      const p = latest.current.position;
      if (p) { const next = clamp(p.x, p.y); if (next.x !== p.x || next.y !== p.y) latest.current.setPosition(next); }
    });
    observer.observe(el); observer.observe(parent);
    return () => { observer.disconnect(); if (drag.current) clearTimeout(drag.current.timer); };
  }, [enabled]);
  const end = () => { if (drag.current) clearTimeout(drag.current.timer); drag.current = null; setDragging(false); };
  return { ref, dragging, style: position ? { left: position.x, top: position.y, right: 'auto' } : undefined,
    handle: {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, textarea, a')) return;
        const el = ref.current;
        if (!el) return;
        end(); e.currentTarget.setPointerCapture(e.pointerId);
        const state = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop, active: false, timer: setTimeout(() => { state.active = true; setDragging(true); }, 280) };
        drag.current = state;
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        const d = drag.current;
        if (d?.active) { e.preventDefault(); setPosition(clamp(d.left + e.clientX - d.x, d.top + e.clientY - d.y)); }
      },
      onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end,
      onDoubleClick: (e: React.MouseEvent<HTMLElement>) => { if (!(e.target as HTMLElement).closest('button')) setPosition(null); },
    },
  };
}
