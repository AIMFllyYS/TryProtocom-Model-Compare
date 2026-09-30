// 面板拖边改尺寸：左边、上边、左上角三条把手（宠物所在的右下角固定）。
// 拖动由主进程跟随光标改窗口尺寸；松手后把最终尺寸记在本机，双击把手恢复默认尺寸。
import { useRef } from 'react';
import { bridge, MIN, type Sized } from './bridge';

export function ResizeEdges({ k, onDone }: { k: Sized; onDone: (s: [number, number] | null) => void }) {
  const on = useRef(false);
  const down = (edge: 'l' | 't' | 'tl') => (e: React.PointerEvent) => {
    if (e.button !== 0 || !bridge) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    on.current = true;
    document.body.classList.add('resizing', `rz-${edge}`);
    bridge.resizeStart(edge, MIN[k][0], MIN[k][1]);
  };
  const up = async () => {
    if (!on.current) return;
    on.current = false;
    document.body.classList.remove('resizing', 'rz-l', 'rz-t', 'rz-tl');
    const r = await bridge?.gestureEnd();
    if (r) onDone([r.w, r.h]);
  };
  const reset = () => onDone(null);
  const props = (edge: 'l' | 't' | 'tl') => ({ onPointerDown: down(edge), onPointerUp: () => void up(), onPointerCancel: () => void up(), onDoubleClick: reset, title: '拖动调节面板大小，双击恢复默认' });
  if (!bridge) return null;
  return (
    <>
      <div className="rz rz-l" {...props('l')} />
      <div className="rz rz-t" {...props('t')} />
      <div className="rz rz-tl" {...props('tl')} />
    </>
  );
}
