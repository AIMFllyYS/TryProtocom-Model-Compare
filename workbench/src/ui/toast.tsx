// 全局轻提示：toast.ok / info / warn / error，可带一个操作按钮。顶部玻璃胶囊，类 iOS 通知。
import { useSyncExternalStore } from 'react';
import { Check, Info, TriangleAlert, X, XCircle } from 'lucide-react';

export interface Toast { id: number; tone: 'ok' | 'info' | 'warn' | 'bad'; text: string; action?: { label: string; run: () => void }; ttl: number }
let list: Toast[] = [];
const subs = new Set<() => void>();
let n = 0;
const emit = () => subs.forEach((f) => f());
function push(tone: Toast['tone'], text: string, o: { action?: Toast['action']; ttl?: number } = {}) {
  const t: Toast = { id: ++n, tone, text, action: o.action, ttl: o.ttl ?? (tone === 'bad' ? 9000 : 4200) };
  list = [...list.slice(-3), t];
  emit();
  setTimeout(() => dismiss(t.id), t.ttl);
  return t.id;
}
export function dismiss(id: number) { list = list.filter((t) => t.id !== id); emit(); }
type O = { action?: Toast['action']; ttl?: number };
export const toast = {
  ok: (t: string, o?: O) => push('ok', t, o),
  info: (t: string, o?: O) => push('info', t, o),
  warn: (t: string, o?: O) => push('warn', t, o),
  error: (t: string, o?: O) => push('bad', t, o),
};

const ICON = { ok: Check, info: Info, warn: TriangleAlert, bad: XCircle };
const CLS = { ok: 'ok', info: 'info', warn: 'warn', bad: 'error' };
export function Toaster() {
  const ts = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => list);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {ts.map((t) => {
        const I = ICON[t.tone];
        return (
          <div key={t.id} className={`toast glass-thick ${CLS[t.tone]}`}>
            <span className="toast-ic"><I size={15} strokeWidth={2.4} aria-hidden /></span>
            <span className="toast-text">{t.text}</span>
            {t.action && <button className="btn sm tinted" onClick={() => { t.action!.run(); dismiss(t.id); }}><span>{t.action.label}</span></button>}
            <button className="icon-btn xs" aria-label="关闭" onClick={() => dismiss(t.id)}><X size={13} /></button>
          </div>
        );
      })}
    </div>
  );
}
