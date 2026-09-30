// 基础组件：按钮、徽标、卡片、分段控件、选项卡、对话框、抽屉、空状态、字段、进度条等。
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check, Copy, Loader2, X } from 'lucide-react';
import { cls, copyText } from '../lib/format';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'ghost' | 'danger' | 'default' | 'subtle'; size?: 'sm' | 'md' | 'xs'; icon?: ReactNode; busy?: boolean; kbd?: string };
export const Btn = forwardRef<HTMLButtonElement, BtnProps>(function Btn({ tone = 'default', size = 'md', icon, busy, kbd, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} className={cls('btn', tone, size, className)} disabled={disabled || busy} {...rest}>
      {busy ? <Loader2 size={14} className="spin" aria-hidden /> : icon}
      {children != null && <span>{children}</span>}
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
});

export const IconBtn = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'xs' | 'sm' | 'md' }>(
  function IconBtn({ label, active, size = 'sm', className, children, ...rest }, ref) {
    return <button ref={ref} className={cls('icon-btn', size, active && 'active', className)} aria-label={label} title={label} aria-pressed={active} {...rest}>{children}</button>;
  });

export function Badge({ tone = 'muted', children, dot, title, className }: { tone?: string; children: ReactNode; dot?: boolean; title?: string; className?: string }) {
  return <span className={cls('badge', `tone-${tone}`, className)} title={title}>{dot && <i className="dot" />}{children}</span>;
}

export function Card({ title, extra, children, className, pad = true, sub }: { title?: ReactNode; extra?: ReactNode; children?: ReactNode; className?: string; pad?: boolean; sub?: ReactNode }) {
  return (
    <section className={cls('card', className)}>
      {(title || extra) && (
        <header className="card-h">
          <div className="card-t">{title}{sub && <span className="card-sub">{sub}</span>}</div>
          {extra && <div className="card-x">{extra}</div>}
        </header>
      )}
      <div className={pad ? 'card-b' : 'card-b nopad'}>{children}</div>
    </section>
  );
}

export function Seg<T extends string>({ value, options, onChange, size = 'sm', label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'xs' | 'sm'; label?: string }) {
  return (
    <div className={cls('seg', size)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} title={o.title} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange, extra }: { value: T; tabs: { value: T; label: ReactNode; count?: number | string; tone?: string }[]; onChange: (v: T) => void; extra?: ReactNode }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}{t.count != null && t.count !== 0 && <span className={cls('tab-count', t.tone && `tone-${t.tone}`)}>{t.count}</span>}
        </button>
      ))}
      {extra && <div className="tabs-x">{extra}</div>}
    </div>
  );
}

function useEsc(on: boolean, fn: () => void) {
  useEffect(() => {
    if (!on) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); fn(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [on, fn]);
}

export function Modal({ open, onClose, title, children, footer, width = 560, className }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; className?: string }) {
  useEsc(open, onClose);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) setTimeout(() => ref.current?.querySelector<HTMLElement>('input,textarea,select,button.primary')?.focus(), 30); }, [open]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={cls('modal', className)} role="dialog" aria-modal="true" aria-labelledby={id} style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
        <header className="modal-h"><h2 id={id}>{title}</h2><IconBtn label="关闭" onClick={onClose}><X size={16} /></IconBtn></header>
        <div className="modal-b">{children}</div>
        {footer && <footer className="modal-f">{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = 720, extra }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number; extra?: ReactNode }) {
  useEsc(open, onClose);
  if (!open) return null;
  return (
    <div className="overlay drawer-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" style={{ width: `min(${width}px, 100vw)` }}>
        <header className="drawer-h"><div className="drawer-t">{title}</div><div className="row gap-s">{extra}<IconBtn label="关闭 (Esc)" onClick={onClose}><X size={16} /></IconBtn></div></header>
        <div className="drawer-b">{children}</div>
      </aside>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-i">{icon}</div>}
      <h3>{title}</h3>
      {children && <div className="empty-t">{children}</div>}
      {action && <div className="empty-a">{action}</div>}
    </div>
  );
}

export function Field({ label, hint, children, error }: { label: ReactNode; hint?: ReactNode; children: ReactNode; error?: string | null }) {
  return (
    <label className={cls('field', error && 'has-err')}>
      <span className="field-l">{label}</span>
      {children}
      {error ? <span className="field-e">{error}</span> : hint && <span className="field-h">{hint}</span>}
    </label>
  );
}

export function Meter({ value, max = 100, tone, w }: { value: number | null | undefined; max?: number; tone?: string; w?: number | string }) {
  const p = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  return <span className={cls('meter', tone && `tone-${tone}`)} style={{ width: w }}><i style={{ width: `${p * 100}%` }} /></span>;
}

export function CopyBtn({ text, label = '复制', size = 'sm' as const, tone = 'default' as const }: { text: string | (() => string); label?: string; size?: 'xs' | 'sm' | 'md'; tone?: 'default' | 'ghost' | 'primary' }) {
  const [ok, setOk] = useState(false);
  return (
    <Btn size={size} tone={tone} icon={ok ? <Check size={14} /> : <Copy size={14} />} onClick={async () => {
      const t = typeof text === 'function' ? text() : text;
      if (await copyText(t)) { setOk(true); setTimeout(() => setOk(false), 1500); }
    }}>{ok ? '已复制' : label}</Btn>
  );
}

export function Kv({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return <dl className="kv">{rows.map(([k, v], i) => <div key={i} className="kv-r"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function Spinner({ size = 16 }: { size?: number }) { return <Loader2 size={size} className="spin" aria-label="加载中" />; }

export function Stat({ label, value, sub, tone, onClick, icon }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string; onClick?: () => void; icon?: ReactNode }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C className={cls('stat', tone && `tone-${tone}`, onClick && 'clickable')} onClick={onClick}>
      <div className="stat-l">{icon}{label}</div>
      <div className="stat-v">{value}</div>
      {sub && <div className="stat-s">{sub}</div>}
    </C>
  );
}

/** 确认对话框（Promise 风格） */
let confirmHost: ((o: ConfirmOpts & { resolve: (b: boolean) => void }) => void) | null = null;
interface ConfirmOpts { title: string; body?: ReactNode; ok?: string; danger?: boolean }
export const confirmDialog = (o: ConfirmOpts) => new Promise<boolean>((resolve) => { if (confirmHost) confirmHost({ ...o, resolve }); else resolve(window.confirm(o.title)); });
export function ConfirmHost() {
  const [st, setSt] = useState<(ConfirmOpts & { resolve: (b: boolean) => void }) | null>(null);
  useEffect(() => { confirmHost = setSt; return () => { confirmHost = null; }; }, []);
  const done = (b: boolean) => { st?.resolve(b); setSt(null); };
  return (
    <Modal open={!!st} onClose={() => done(false)} title={st?.title || ''} width={440}
      footer={<><Btn tone="ghost" onClick={() => done(false)}>取消</Btn><Btn tone={st?.danger ? 'danger' : 'primary'} onClick={() => done(true)}>{st?.ok || '确定'}</Btn></>}>
      {st?.body && <div className="muted">{st.body}</div>}
    </Modal>
  );
}

export function Split({ left, right, initial = 0.5, min = 0.15, dir = 'h', storeKey }: { left: ReactNode; right: ReactNode; initial?: number; min?: number; dir?: 'h' | 'v'; storeKey?: string }) {
  const [r, setR] = useState(() => Number(storeKey && localStorage.getItem('wb.split.' + storeKey)) || initial);
  const ref = useRef<HTMLDivElement>(null);
  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current!;
    const box = el.getBoundingClientRect();
    document.body.classList.add(dir === 'h' ? 'dragging-h' : 'dragging-v');
    const mv = (ev: PointerEvent) => {
      const v = dir === 'h' ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
      const c = Math.max(min, Math.min(1 - min, v));
      setR(c);
      if (storeKey) localStorage.setItem('wb.split.' + storeKey, String(c));
    };
    const up = () => { document.body.classList.remove('dragging-h', 'dragging-v'); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  return (
    <div ref={ref} className={cls('split', dir)} style={{ ['--r' as string]: String(r) }}>
      <div className="split-a">{left}</div>
      <div className="split-g" onPointerDown={drag} role="separator" aria-orientation={dir === 'h' ? 'vertical' : 'horizontal'} />
      <div className="split-b">{right}</div>
    </div>
  );
}
