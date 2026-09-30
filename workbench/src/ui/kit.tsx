// 统一组件库（Liquid Glass）：所有页面只用这里的组件，不直接使用浏览器原生 select / title 提示。
import {
  cloneElement, forwardRef, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type CSSProperties, type ReactElement, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Copy, Loader2, Search, X } from 'lucide-react';
import { cls, copyText } from '../lib/format';

// ============================================================ 浮层定位
type Place = 'bottom-start' | 'bottom-end' | 'bottom' | 'top-start' | 'top' | 'right-start' | 'left-start';
export function usePopPosition(anchor: RefObject<HTMLElement | null>, open: boolean, place: Place = 'bottom-start', offset = 8, matchWidth = false) {
  const [st, setSt] = useState<CSSProperties>({ visibility: 'hidden' });
  const pop = useRef<HTMLDivElement>(null);
  const calc = useCallback(() => {
    const a = anchor.current, p = pop.current;
    if (!a || !p) return;
    const r = a.getBoundingClientRect();
    const pw = Math.max(p.offsetWidth, matchWidth ? r.width : 0), ph = p.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top: number, left: number, origin = 'top left';
    if (place.startsWith('right')) { left = r.right + offset; top = r.top; origin = 'left top'; if (left + pw > vw - 8) left = r.left - pw - offset; }
    else if (place.startsWith('left')) { left = r.left - pw - offset; top = r.top; origin = 'right top'; }
    else {
      const below = !place.startsWith('top');
      top = below ? r.bottom + offset : r.top - ph - offset;
      if (below && top + ph > vh - 8 && r.top - ph - offset > 8) { top = r.top - ph - offset; origin = 'bottom left'; }
      if (!below && top < 8) top = r.bottom + offset;
      left = place.endsWith('end') ? r.right - pw : place === 'bottom' || place === 'top' ? r.left + r.width / 2 - pw / 2 : r.left;
      if (place.endsWith('end')) origin = origin.replace('left', 'right');
    }
    left = Math.max(8, Math.min(left, vw - pw - 8));
    top = Math.max(8, Math.min(top, vh - ph - 8));
    setSt({ top, left, minWidth: matchWidth ? r.width : undefined, ['--origin' as string]: origin });
  }, [anchor, place, offset, matchWidth]);
  useLayoutEffect(() => {
    if (!open) { setSt({ visibility: 'hidden' }); return; }
    calc();
    const on = () => calc();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    const ro = new ResizeObserver(on);
    if (pop.current) ro.observe(pop.current);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('scroll', on, true); ro.disconnect(); };
  }, [open, calc]);
  return { pop, style: st };
}

function useOutside(open: boolean, refs: RefObject<HTMLElement | null>[], onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (!refs.some((r) => r.current?.contains(e.target as Node))) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', h, true);
    window.addEventListener('keydown', k, true);
    return () => { window.removeEventListener('pointerdown', h, true); window.removeEventListener('keydown', k, true); };
  }, [open]); // eslint-disable-line
}

export const Portal = ({ children }: { children: ReactNode }) => createPortal(children, document.body);

// ============================================================ 提示
export function Tip({ text, children, place = 'top', delay = 380 }: { text: ReactNode; children: ReactElement; place?: Place; delay?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  const t = useRef<number | undefined>(undefined);
  const { pop, style } = usePopPosition(ref, open, place, 8);
  useEffect(() => () => clearTimeout(t.current), []);
  if (!isValidElement(children) || text == null || text === '') return children;
  const p = children.props as Record<string, any>;
  const child = cloneElement(children as ReactElement<any>, {
    ref: (el: HTMLElement) => { ref.current = el; const r = p.ref; if (typeof r === 'function') r(el); else if (r) r.current = el; },
    onPointerEnter: (e: any) => { p.onPointerEnter?.(e); clearTimeout(t.current); t.current = window.setTimeout(() => setOpen(true), delay); },
    onPointerLeave: (e: any) => { p.onPointerLeave?.(e); clearTimeout(t.current); setOpen(false); },
    onPointerDown: (e: any) => { p.onPointerDown?.(e); clearTimeout(t.current); setOpen(false); },
    onFocus: (e: any) => { p.onFocus?.(e); if ((e.target as HTMLElement).matches(':focus-visible')) setOpen(true); },
    onBlur: (e: any) => { p.onBlur?.(e); setOpen(false); },
  });
  return (<>{child}{open && <Portal><div ref={pop} role="tooltip" className="tip glass-thick" style={style}>{text}</div></Portal>}</>);
}

// ============================================================ 按钮
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'tinted' | 'ghost' | 'danger' | 'default' | 'subtle' | 'ok'; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; icon?: ReactNode; iconRight?: ReactNode; busy?: boolean; kbd?: string; block?: boolean; tip?: ReactNode };
export const Btn = forwardRef<HTMLButtonElement, BtnProps>(function Btn({ tone = 'default', size = 'md', icon, iconRight, busy, kbd, block, className, children, disabled, tip, title, ...rest }, ref) {
  const b = (
    <button ref={ref} className={cls('btn sheen', tone, size !== 'md' && size, block && 'block', className)} disabled={disabled || busy} {...rest}>
      <span className="sheen-l" aria-hidden />
      {busy ? <Loader2 size={size === 'xs' ? 12 : 14} className="spin" aria-hidden /> : icon}
      {children != null && children !== false && <span>{children}</span>}
      {iconRight}
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
  return tip || title ? <Tip text={tip || title}>{b}</Tip> : b;
});

export const IconBtn = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'xs' | 'sm' | 'md' | 'lg'; glassy?: boolean; tipPlace?: Place }>(
  function IconBtn({ label, active, size = 'sm', glassy, className, children, title: _t, tipPlace, ...rest }, ref) {
    return (
      <Tip text={label} place={tipPlace}>
        <button ref={ref} className={cls('icon-btn', size !== 'sm' && size, active && 'active', glassy && 'glassy', className)} aria-label={label} aria-pressed={active} {...rest}>{children}</button>
      </Tip>
    );
  });

export function CopyBtn({ text, label = '复制', size = 'sm', tone = 'default', icon, onCopied, done = '已复制' }: { text: string | (() => string | Promise<string>); label?: ReactNode; size?: BtnProps['size']; tone?: BtnProps['tone']; icon?: ReactNode; onCopied?: () => void; done?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Btn size={size} tone={tone} icon={ok ? <Check size={14} /> : icon || <Copy size={14} />} onClick={async () => {
      const t = typeof text === 'function' ? await text() : text;
      if (await copyText(t)) { setOk(true); onCopied?.(); setTimeout(() => setOk(false), 1600); }
    }}>{ok ? done : label}</Btn>
  );
}

// ============================================================ 徽标 / 卡片 / 杂项
export function Badge({ tone = 'muted', children, dot, title, className, size }: { tone?: string; children: ReactNode; dot?: boolean; title?: string; className?: string; size?: 'lg' }) {
  const b = <span className={cls('badge', `tone-${tone}`, size, className)}>{dot && <i className="dot" />}{children}</span>;
  return title ? <Tip text={title}>{b}</Tip> : b;
}

export function Card({ title, extra, children, className, pad = true, sub, flat, style }: { title?: ReactNode; extra?: ReactNode; children?: ReactNode; className?: string; pad?: boolean; sub?: ReactNode; flat?: boolean; style?: CSSProperties }) {
  return (
    <section className={cls('card', flat ? 'flat' : 'glass', className)} style={style}>
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

export function Field({ label, hint, children, error, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; error?: string | null; className?: string }) {
  return (
    <label className={cls('field', error && 'has-err', className)}>
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
export function Ring({ value, size = 40, tone = 'ok', children }: { value: number; size?: number; tone?: string; children?: ReactNode }) {
  return <span className="ring" style={{ ['--p' as string]: Math.max(0, Math.min(100, value)), ['--s' as string]: `${size}px`, ['--c' as string]: `var(--${tone})` }}><span>{children}</span></span>;
}

export function Kv({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return <dl className="kv">{rows.map(([k, v], i) => <div key={i} className="kv-r"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
export function Spinner({ size = 16 }: { size?: number }) { return <Loader2 size={size} className="spin" aria-label="加载中" />; }
export const Kbd = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>;

export function Stat({ label, value, sub, tone, onClick, icon, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string; onClick?: () => void; icon?: ReactNode; className?: string }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C className={cls('stat glass', tone && `tone-${tone}`, onClick && 'clickable sheen', className)} onClick={onClick}>
      {onClick && <span className="sheen-l" aria-hidden />}
      <div className="stat-l">{icon}{label}</div>
      <div className="stat-v">{value}</div>
      {sub && <div className="stat-s">{sub}</div>}
    </C>
  );
}

export function Switch({ checked, onChange, label, size, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; size?: 'sm'; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={cls('switch', size)} onClick={() => onChange(!checked)} />;
}
export function CheckBox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className="check" onClick={(e) => { e.stopPropagation(); onChange(!checked); }}><Check size={12} strokeWidth={3} /></button>;
}
export function ToggleRow({ title, desc, checked, onChange }: { title: ReactNode; desc?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return <div className="toggle-row"><div className="grow"><b>{title}</b>{desc && <span>{desc}</span>}</div><Switch checked={checked} onChange={onChange} label={String(title)} /></div>;
}

export function SearchInput({ value, onChange, placeholder = '搜索', className, autoFocus, size }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean; size?: 'sm' }) {
  return (
    <div className={cls('search', className)}>
      <Search size={14} aria-hidden />
      <input className={cls('input', size)} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} aria-label={placeholder} />
      {value && <button className="icon-btn xs" style={{ position: 'absolute', right: 4 }} onClick={() => onChange('')} aria-label="清空"><X size={12} /></button>}
    </div>
  );
}

// ============================================================ 分段控件（滑动透镜）
function useThumb(dep: unknown) {
  const box = useRef<HTMLDivElement>(null);
  const [th, setTh] = useState<CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>('[aria-checked="true"],[aria-selected="true"]');
      if (!on) { setTh({ opacity: 0 }); return; }
      setTh({ opacity: 1, width: on.offsetWidth, transform: `translateX(${on.offsetLeft}px)` });
      on.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dep]);
  return { box, th };
}

export function Seg<T extends string>({ value, options, onChange, size = 'sm', label, className }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'xs' | 'sm' | 'lg'; label?: string; className?: string }) {
  const { box, th } = useThumb(value + options.length);
  return (
    <div ref={box} className={cls('seg', size !== 'sm' && size, className)} role="radiogroup" aria-label={label}>
      <span className="seg-thumb lens" style={th} aria-hidden />
      {options.map((o) => {
        const b = <button key={o.value} type="button" role="radio" aria-checked={value === o.value} aria-label={o.title} onClick={() => onChange(o.value)}>{o.label}</button>;
        return o.title ? <Tip key={o.value} text={o.title}>{b}</Tip> : b;
      })}
    </div>
  );
}

/** 顶部选项卡栏（题目 T01–T08 等）：玻璃胶囊 + 滑动透镜 */
export function TabBar<T extends string>({ value, tabs, onChange, className, label }: { value: T; tabs: { value: T; label: ReactNode; badge?: ReactNode; title?: string }[]; onChange: (v: T) => void; className?: string; label?: string }) {
  const { box, th } = useThumb(value + tabs.length);
  return (
    <div ref={box} className={cls('tabbar glass-thin', className)} role="tablist" aria-label={label} style={{ position: 'relative' }}
      onKeyDown={(e) => {
        const i = tabs.findIndex((t) => t.value === value);
        if (e.key === 'ArrowRight' && i < tabs.length - 1) { e.preventDefault(); onChange(tabs[i + 1].value); }
        if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); onChange(tabs[i - 1].value); }
      }}>
      <span className="seg-thumb lens" style={th} aria-hidden />
      {tabs.map((t) => {
        const b = <button key={t.value} type="button" role="tab" className="tab" aria-selected={value === t.value} tabIndex={value === t.value ? 0 : -1} onClick={() => onChange(t.value)}>{t.label}{t.badge}</button>;
        return t.title ? <Tip key={t.value} text={t.title} place="bottom">{b}</Tip> : b;
      })}
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

// ============================================================ 下拉选择
export interface Opt<T extends string = string> { value: T; label: ReactNode; text?: string; icon?: ReactNode; desc?: ReactNode; group?: string; disabled?: boolean; right?: ReactNode }
export function Select<T extends string>({ value, onChange, options, placeholder = '请选择', size, block, glassy, searchable, label, className, render, place = 'bottom-start', disabled, footer }: {
  value: T | '' | null | undefined; onChange: (v: T) => void; options: Opt<T>[]; placeholder?: ReactNode; size?: 'xs' | 'sm' | 'lg'; block?: boolean; glassy?: boolean;
  searchable?: boolean; label?: string; className?: string; render?: (o: Opt<T> | undefined) => ReactNode; place?: Place; disabled?: boolean; footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(-1);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { pop, style } = usePopPosition(btn, open, place, 6, true);
  useOutside(open, [btn, pop], () => setOpen(false));
  const cur = options.find((o) => o.value === value);
  const text = (o: Opt<T>) => (o.text || (typeof o.label === 'string' ? o.label : String(o.value))).toLowerCase();
  const list = useMemo(() => (q ? options.filter((o) => text(o).includes(q.toLowerCase()) || String(o.value).toLowerCase().includes(q.toLowerCase())) : options), [q, options]); // eslint-disable-line
  useEffect(() => { if (open) { setHl(Math.max(0, list.findIndex((o) => o.value === value))); } else setQ(''); }, [open]); // eslint-disable-line
  useEffect(() => { if (open && hl >= 0) pop.current?.querySelector(`[data-i="${hl}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hl, open]); // eslint-disable-line
  const pick = (o: Opt<T>) => { if (o.disabled) return; onChange(o.value); setOpen(false); btn.current?.focus(); };
  const key = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(list.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[hl]) pick(list[hl]); }
    else if (e.key === 'Tab') setOpen(false);
  };
  let lastGroup: string | undefined;
  return (
    <>
      <button ref={btn} type="button" className={cls('select', size, block && 'block', glassy && 'glassy', className)} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-label={label} disabled={disabled}
        onClick={() => setOpen((o) => !o)} onKeyDown={key}>
        <span className="sel-v">{render ? render(cur) : cur ? <>{cur.icon}{cur.label}</> : <span className="sel-ph">{placeholder}</span>}</span>
        <ChevronDown size={size === 'xs' ? 12 : 14} className="sel-c" aria-hidden />
      </button>
      {open && (
        <Portal>
          <div ref={pop} id={id} role="listbox" className="pop list glass-thick" style={style} onKeyDown={key} tabIndex={-1}>
            {searchable && <div className="pop-search"><SearchInput value={q} onChange={(v) => { setQ(v); setHl(0); }} placeholder="筛选…" autoFocus size="sm" /></div>}
            {list.map((o, i) => {
              const g = o.group !== lastGroup ? o.group : undefined;
              lastGroup = o.group;
              return (
                <div key={String(o.value)}>
                  {g && <div className="pop-group">{g}</div>}
                  <button type="button" role="option" data-i={i} aria-selected={i === hl} className={cls('opt', o.value === value && 'on')} disabled={o.disabled}
                    onMouseEnter={() => setHl(i)} onClick={() => pick(o)}>
                    {o.icon}
                    <span className="opt-t">{o.label}{o.desc && <span className="opt-d">{o.desc}</span>}</span>
                    {o.right}
                    {o.value === value && <Check size={14} className="opt-check" />}
                  </button>
                </div>
              );
            })}
            {!list.length && <div className="pop-empty">没有匹配项</div>}
            {footer && <><div className="pop-sep" />{footer}</>}
          </div>
        </Portal>
      )}
    </>
  );
}

// ============================================================ 菜单 / 弹出层
export interface MenuItem { label?: ReactNode; icon?: ReactNode; onClick?: () => void; danger?: boolean; kbd?: string; disabled?: boolean; sep?: boolean; group?: string; desc?: ReactNode; checked?: boolean }
export function Menu({ trigger, items, place = 'bottom-end', width }: { trigger: (p: { ref: RefObject<HTMLButtonElement | null>; onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode; items: MenuItem[]; place?: Place; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { pop, style } = usePopPosition(ref, open, place, 6);
  useOutside(open, [ref, pop], () => setOpen(false));
  return (
    <>
      {trigger({ ref, onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <Portal>
          <div ref={pop} role="menu" className="pop glass-thick" style={{ ...style, width }}>
            {items.map((it, i) => it.sep ? <div key={i} className="pop-sep" /> : it.group && !it.label ? <div key={i} className="pop-group">{it.group}</div> : (
              <button key={i} type="button" role="menuitem" className={cls('opt', it.danger && 'danger')} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick?.(); }}>
                {it.icon}<span className="opt-t">{it.label}{it.desc && <span className="opt-d">{it.desc}</span>}</span>
                {it.kbd && <span className="opt-k">{it.kbd}</span>}
                {it.checked && <Check size={14} className="opt-check" />}
              </button>
            ))}
          </div>
        </Portal>
      )}
    </>
  );
}

export function Popover({ trigger, children, place = 'bottom-end', width, className }: { trigger: (p: { ref: RefObject<HTMLButtonElement | null>; onClick: () => void; 'aria-expanded': boolean }) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); place?: Place; width?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { pop, style } = usePopPosition(ref, open, place, 8);
  useOutside(open, [ref, pop], () => setOpen(false));
  const close = () => setOpen(false);
  return (
    <>
      {trigger({ ref, onClick: () => setOpen((o) => !o), 'aria-expanded': open })}
      {open && <Portal><div ref={pop} className={cls('pop glass-thick', className)} style={{ ...style, width, padding: 0 }} role="dialog">{typeof children === 'function' ? children(close) : children}</div></Portal>}
    </>
  );
}

// ============================================================ 右键菜单（全局宿主，挂在 main.tsx）
// openContextMenu(e, items)：在指针位置弹出与 Menu 同款的玻璃菜单；键盘 ↑↓ / Enter / Esc；
// 传入元素（例如“⋯”按钮）时贴着元素弹出，方便不用右键的人。
interface CtxState { x: number; y: number; items: MenuItem[]; title?: ReactNode; back: HTMLElement | null }
let ctxHost: ((s: CtxState | null) => void) | null = null;
export function openContextMenu(at: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void } | HTMLElement, items: MenuItem[], title?: ReactNode) {
  let x: number, y: number;
  if (at instanceof HTMLElement) { const r = at.getBoundingClientRect(); x = r.right; y = r.bottom + 6; }
  else { at.preventDefault?.(); at.stopPropagation?.(); x = at.clientX; y = at.clientY; }
  ctxHost?.({ x, y, items, title, back: (document.activeElement as HTMLElement) || null });
}
export function ContextMenuHost() {
  const [st, setSt] = useState<CtxState | null>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });
  const ref = useRef<HTMLDivElement>(null);
  const stRef = useRef(st);
  stRef.current = st;
  useEffect(() => { ctxHost = setSt; return () => { ctxHost = null; }; }, []);
  const close = useCallback((restore = true) => { const s = stRef.current; setSt(null); if (restore) s?.back?.focus?.({ preventScroll: true }); }, []);
  useLayoutEffect(() => {
    if (!st || !ref.current) { setPos({ visibility: 'hidden' }); return; }
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    const flipX = st.x + w > vw - 8, flipY = st.y + h > vh - 8;
    const left = Math.max(8, flipX ? st.x - w : st.x), top = Math.max(8, flipY ? Math.max(8, st.y - h) : st.y);
    setPos({ left, top, ['--origin' as string]: `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}` });
    ref.current.querySelector<HTMLElement>('button.opt:not(:disabled)')?.focus({ preventScroll: true });
  }, [st]);
  useEffect(() => {
    if (!st) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(false); };
    const off = () => close(false);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', esc, true);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('resize', off);
    window.addEventListener('blur', off);
    window.addEventListener('scroll', off, true);
    return () => { window.removeEventListener('keydown', esc, true); window.removeEventListener('pointerdown', down, true); window.removeEventListener('resize', off); window.removeEventListener('blur', off); window.removeEventListener('scroll', off, true); };
  }, [st, close]);
  if (!st) return null;
  const key = (e: React.KeyboardEvent) => {
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button.opt:not(:disabled)') || [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); btns[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); btns[btns.length - 1]?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  return (
    <Portal>
      <div ref={ref} role="menu" className="pop ctx glass-thick" style={pos} onKeyDown={key} onContextMenu={(e) => e.preventDefault()}>
        {st.title && <div className="ctx-t">{st.title}</div>}
        {st.items.map((it, i) => it.sep ? <div key={i} className="pop-sep" /> : it.group && !it.label ? <div key={i} className="pop-group">{it.group}</div> : (
          <button key={i} type="button" role="menuitem" className={cls('opt', it.danger && 'danger')} disabled={it.disabled} onClick={() => { close(); it.onClick?.(); }}>
            {it.icon}<span className="opt-t">{it.label}{it.desc && <span className="opt-d">{it.desc}</span>}</span>
            {it.kbd && <span className="opt-k">{it.kbd}</span>}
          </button>
        ))}
      </div>
    </Portal>
  );
}

// ============================================================ 对话框 / 抽屉
function useEsc(on: boolean, fn: () => void) {
  useEffect(() => {
    if (!on) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); fn(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [on, fn]);
}

export function Modal({ open, onClose, title, sub, children, footer, width = 560, className }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; className?: string }) {
  useEsc(open, onClose);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) setTimeout(() => ref.current?.querySelector<HTMLElement>('[autofocus],input,textarea,button.primary')?.focus(), 40); }, [open]);
  if (!open) return null;
  return (
    <Portal>
      <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div ref={ref} className={cls('modal glass-thick', className)} role="dialog" aria-modal="true" aria-labelledby={id} style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
          <header className="modal-h"><h2 id={id}>{title}{sub && <span className="modal-sub">{sub}</span>}</h2><IconBtn label="关闭 (Esc)" onClick={onClose}><X size={16} /></IconBtn></header>
          <div className="modal-b">{children}</div>
          {footer && <footer className="modal-f">{footer}</footer>}
        </div>
      </div>
    </Portal>
  );
}

export function Drawer({ open, onClose, title, children, width = 720, extra }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number; extra?: ReactNode }) {
  useEsc(open, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="overlay drawer-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <aside className="drawer glass-thick" role="dialog" aria-modal="true" style={{ width: `min(${width}px, calc(100vw - 20px))` }}>
          <header className="drawer-h"><div className="drawer-t">{title}</div><div className="row gap-s">{extra}<IconBtn label="关闭 (Esc)" onClick={onClose}><X size={16} /></IconBtn></div></header>
          <div className="drawer-b">{children}</div>
        </aside>
      </div>
    </Portal>
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
      {st?.body && <div className="dim">{st.body}</div>}
    </Modal>
  );
}

export function Split({ left, right, initial = 0.5, min = 0.15, dir = 'h', storeKey }: { left: ReactNode; right: ReactNode; initial?: number; min?: number; dir?: 'h' | 'v'; storeKey?: string }) {
  const [r, setR] = useState(() => Number(storeKey && localStorage.getItem('wb.split.' + storeKey)) || initial);
  const ref = useRef<HTMLDivElement>(null);
  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const box = ref.current!.getBoundingClientRect();
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
