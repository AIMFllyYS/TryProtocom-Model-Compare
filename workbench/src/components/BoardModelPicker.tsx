import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Check, ChevronRight, Download, ListFilter, Search, X } from 'lucide-react';
import { vendorById } from '../../shared/vendors';
import { type BoardModel, type ModelSelection } from '../lib/boardModels';
import { cls } from '../lib/format';
import { BrandIcon, ModelAvatar } from '../ui/brand';
import { Btn, IconBtn, Portal, usePopPosition } from '../ui/kit';

interface Props {
  models: BoardModel[];
  anchor: RefObject<HTMLButtonElement | null>;
  value: ModelSelection;
  onChange: (value: ModelSelection) => void;
  onClose: () => void;
  modelName: (vendor: string, name: string) => string;
  blind: boolean;
  exportName?: string;
  onExport?: () => Promise<void>;
  canExport?: boolean;
}

export function BoardModelPicker({ models, anchor, value, onChange: changeSelection, onClose, modelName, blind, exportName, onExport, canExport }: Props) {
  const { pop, style } = usePopPosition(anchor, true, 'bottom-start', 10);
  const search = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<number>(undefined);
  const closing = useRef(false);
  const [query, setQuery] = useState('');
  const [vendor, setVendor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismiss = (restoreFocus = true) => {
    if (closing.current) return;
    closing.current = true;
    if (pop.current) pop.current.dataset.closing = 'true';
    if (restoreFocus) anchor.current?.focus({ preventScroll: true });
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) onCloseRef.current();
    else closeTimer.current = window.setTimeout(() => onCloseRef.current(), 180);
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.button === 0 && event.target instanceof Node && !pop.current?.contains(event.target) && !anchor.current?.contains(event.target)) dismiss(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.clearTimeout(closeTimer.current);
    };
  }, [anchor, pop]);
  useEffect(() => {
    if (style.visibility !== 'hidden') search.current?.focus({ preventScroll: true });
  }, [style.visibility]);
  const selected = new Set(value ?? models.map((m) => m.key));
  const onChange = (next: ModelSelection) => { setError(''); changeSelection(next); };
  const update = (keys: string[], check: boolean) => {
    const next = new Set(selected);
    for (const key of keys) check ? next.add(key) : next.delete(key);
    onChange(next.size === models.length && models.every((m) => next.has(m.key)) ? null : [...next]);
  };
  const groups = new Map<string, BoardModel[]>();
  for (const model of models) {
    const group = groups.get(model.vendor);
    if (group) group.push(model);
    else groups.set(model.vendor, [model]);
  }
  const vendorCodes = [...groups.keys()].sort();
  const vendorName = (key: string) => blind ? `供应商 ${vendorCodes.indexOf(key) + 1}` : vendorById(key)?.name ?? (key || '供应商未登记');
  const term = query.trim().toLocaleLowerCase();
  const visible = new Map([...groups].flatMap(([key, entries]) => {
    const match = vendorName(key).toLocaleLowerCase().includes(term) ? entries
      : entries.filter((m) => modelName(m.vendor, m.name).toLocaleLowerCase().includes(term));
    return match.length ? [[key, match] as const] : [];
  }));
  const active = vendor !== null && visible.has(vendor) ? vendor : visible.keys().next().value;
  const matches = active === undefined ? [] : visible.get(active) ?? [];
  const count = models.filter((m) => selected.has(m.key)).length;
  const moveVendor = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    buttons[(index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  };
  return (
    <Portal>
      <div ref={pop} className="board-picker glass-thick" id="board-model-picker" role="dialog" aria-labelledby="board-model-picker-title" style={style}>
        <div className="board-picker-inner">
          <header className="board-picker-head">
            <span className="board-picker-symbol" aria-hidden>{exportName ? <Download size={20} /> : <ListFilter size={20} />}</span>
            <div className="grow">
              <h2 id="board-model-picker-title">{exportName ? '导出高清图片' : '筛选榜单模型'}</h2>
              {exportName && <span className="small muted">{exportName} · 3× PNG</span>}
            </div>
            <IconBtn label="关闭模型选择 (Esc)" onClick={() => dismiss()}><X size={17} /></IconBtn>
          </header>
          <label className="board-picker-search">
            <Search size={16} aria-hidden />
            <input type="search" ref={search} aria-label="搜索供应商或模型" placeholder="搜索供应商或模型" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="board-picker-content">
            <div className="board-picker-vendors">
              <div className="board-picker-label">供应商</div>
              <div className="board-picker-list" aria-label="供应商" onKeyDown={moveVendor}>
                {[...visible].map(([key, entries]) => {
                  const n = entries.filter((m) => selected.has(m.key)).length;
                  const brand = blind ? undefined : vendorById(key);
                  return <button type="button" key={key} className={cls('board-picker-vendor', active === key && 'on')} aria-pressed={active === key}
                    onFocus={() => setVendor(key)} onClick={() => setVendor(key)}>
                    <BrandIcon icon={brand?.icon} color={blind ? '#8a8fa3' : brand?.color} fallback={blind ? '?' : key || '?'} size="xs" />
                    <span className="ellipsis">{vendorName(key)}</span><small>{n}/{entries.length}</small><ChevronRight size={13} aria-hidden />
                  </button>;
                })}
              </div>
            </div>
            <div className="board-picker-models">
              <div className="board-picker-label">
                <span>{active === undefined ? '模型' : vendorName(active)}</span>
                {matches.length > 0 && <Btn size="xs" tone="ghost" onClick={() => update(matches.map((m) => m.key), !matches.every((m) => selected.has(m.key)))}>
                  {matches.every((m) => selected.has(m.key)) ? '取消本组' : '选择本组'}
                </Btn>}
              </div>
              <div className="board-picker-list">
                {matches.length ? matches.map((m) => (
                  <label key={m.key} className="board-picker-model">
                    <ModelAvatar vendor={m.vendor} model={m.name} size="sm" blind={blind} />
                    <span className="grow">{modelName(m.vendor, m.name)}</span>
                    <input type="checkbox" checked={selected.has(m.key)} onChange={(e) => update([m.key], e.target.checked)} />
                    <span className="board-picker-check" aria-hidden><Check size={13} strokeWidth={2.8} /></span>
                  </label>
                )) : <div className="board-picker-empty">{term ? '没有匹配的供应商或模型' : '当前没有可选模型'}</div>}
              </div>
            </div>
          </div>
          <footer className="board-picker-foot">
            <span className="board-picker-count" aria-live="polite">{count === models.length && count > 0 ? `全部 ${count} 个模型` : `已选 ${count} / ${models.length}`}</span>
            <Btn size="sm" tone="ghost" disabled={count === models.length} onClick={() => onChange(null)}>全选</Btn>
            <Btn size="sm" tone="ghost" disabled={!count} onClick={() => onChange([])}>清空</Btn>
            <span className="grow" />
            {onExport ? <Btn size="sm" tone="primary" busy={busy} disabled={!canExport} icon={<Download size={15} />} onClick={async () => {
              if (closing.current) return;
              setBusy(true);
              setError('');
              try { await onExport(); dismiss(); }
              catch (e) { setError(e instanceof Error ? e.message : '导出榜单图片失败'); }
              finally { setBusy(false); }
            }}>下载 PNG</Btn> : <Btn size="sm" tone="primary" onClick={() => dismiss()}>完成</Btn>}
            {error && <div className="board-picker-error" role="alert">{error}</div>}
          </footer>
        </div>
      </div>
    </Portal>
  );
}
