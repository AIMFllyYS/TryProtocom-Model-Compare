import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArtifactTree } from './ArtifactTree';

export function StageTabMenu({ x, y, tabs, selected, onSelect, onCloseTab, onCloseOthers, onOpen, onDismiss }: {
  x: number; y: number; tabs: { id: string; label: string }[]; selected: string;
  onSelect: (id: string) => void; onCloseTab: () => void; onCloseOthers: () => void; onOpen: (ref: string) => void; onDismiss: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useLayoutEffect(() => {
    const el = root.current!;
    const fit = () => setPos({ left: Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8)), top: Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8)) });
    const observer = new ResizeObserver(fit);
    observer.observe(el); fit(); el.focus();
    return () => observer.disconnect();
  }, [x, y]);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) dismiss.current(); };
    const off = () => dismiss.current();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('blur', off);
    window.addEventListener('resize', off);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('blur', off); window.removeEventListener('resize', off); };
  }, []);
  const act = (fn: () => void) => { onDismiss(); fn(); };
  return createPortal(<div ref={root} tabIndex={-1} role="dialog" aria-label="标签页菜单" className="stage-tab-menu glass-thick" style={pos}
    onContextMenu={(e) => e.preventDefault()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onDismiss(); } }}>
    <button className="opt" onClick={() => act(onCloseTab)}>关闭当前标签页</button>
    <button className="opt" disabled={tabs.length < 2} onClick={() => act(onCloseOthers)}>关闭其他标签页</button>
    <details><summary>打开指定标签页</summary><div className="stage-tab-list">{tabs.map((tab) => <button className="opt" key={tab.id} aria-current={tab.id === selected ? 'page' : undefined} onClick={() => act(() => onSelect(tab.id))}>{tab.label}</button>)}</div></details>
    <details><summary>运行产物</summary><ArtifactTree onOpen={(ref) => act(() => onOpen(ref))} /></details>
  </div>, document.body);
}
