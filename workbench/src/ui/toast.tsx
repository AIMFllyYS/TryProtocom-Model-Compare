// 全局轻提示：toast.ok / info / warn / error，可带一个操作按钮。
import { useSyncExternalStore } from 'react';
import { CheckCircle2, Info, TriangleAlert, XCircle, X } from 'lucide-react';

export interface Toast { id: number; tone: 'ok' | 'info' | 'warn' | 'bad'; text: string; action?: { label: string; run: () => void }; ttl: number }
let list: Toast[] = [];
const subs = new Set<() => void>();
let n = 0;
const emit = () => subs.forEach((f) => f());
function push(tone: Toast['tone'], text: string, o: { action?: Toast['action']; ttl?: number } = {}) {
  const t: Toast = { id: ++n, tone, text, action: o.action, ttl: o.ttl ?? (tone === 'bad' ? 9000 : 4200) };
  list = [...list.slice(-4), t];
  emit();
  setTimeout(() => dismiss(t.id), t.ttl);
  return t.id;
}
export function dismiss(id: number) { list = list.filter((t) => t.id !== id); emit(); }
export const toast = {
  ok: (t: string, o?: { action?: Toast['action']; ttl?: number }) => push('ok', t, o),
  info: (t: string, o?: { action?: Toast['action']; ttl?: number }) => push('info', t, o),
  warn: (t: string, o?: { action?: Toast['action']; ttl?: number }) => push('warn', t, o),
  error: (t: string, o?: { action?: Toast['action']; ttl?: number }) => push('bad', t, o),
};

const ICON = { ok: CheckCircle2, info: Info, warn: TriangleAlert, bad: XCircle };
export function Toaster() {
  const ts = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => list);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {ts.map((t) => {
        const I = ICON[t.tone];
        return (
          <div key={t.id} className={`toast tone-${t.tone}`}>
            <I size={16} aria-hidden />
            <span className="toast-text">{t.text}</span>
            {t.action && <button className="btn sm ghost" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
            <button className="icon-btn xs" aria-label="关闭" onClick={() => dismiss(t.id)}><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}
