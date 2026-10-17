import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { cls } from '../lib/format';
import { Spinner } from '../ui/kit';

export interface ExplorerNode {
  id: string; label: string; title?: string; branch?: boolean; children?: ExplorerNode[];
  icon?: ReactNode; meta?: ReactNode; action?: ReactNode; checked?: boolean; loading?: boolean;
}

/** Shared compact rows and keyboard navigation for artifact groups and real files. */
export function ExplorerTree({ nodes, expanded, onToggle, onSelect, onActivate, onCheck, selected, label, className }: {
  nodes: ExplorerNode[]; expanded: Set<string>; onToggle: (id: string) => void;
  onSelect?: (id: string) => void; onActivate?: (id: string) => void; onCheck?: (id: string) => void;
  selected?: string; label: string; className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState('');
  const rows = useMemo(() => {
    const list: { node: ExplorerNode; depth: number; parent?: string; pos: number; size: number }[] = [];
    const walk = (items: ExplorerNode[], depth: number, parent?: string) => items.forEach((node, i) => {
      list.push({ node, depth, parent, pos: i + 1, size: items.length });
      if (node.branch && expanded.has(node.id)) walk(node.children || [], depth + 1, node.id);
    });
    walk(nodes, 0); return list;
  }, [nodes, expanded]);
  const focusId = rows.some((r) => r.node.id === focus) ? focus : rows[0]?.node.id;
  const move = (id?: string) => {
    if (id === undefined) return;
    setFocus(id);
    const el = [...(root.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') || [])].find((e) => e.dataset.node === id);
    el?.focus({ preventScroll: true }); el?.scrollIntoView({ block: 'nearest' });
  };
  return <div ref={root} className={cls('explorer-tree', className)} role="tree" aria-label={label} aria-multiselectable={onCheck ? true : undefined}>
    {rows.map(({ node, depth, parent, pos, size }, index) => <div key={node.id} role="treeitem" data-node={node.id}
      aria-label={node.label} aria-level={depth + 1} aria-posinset={pos} aria-setsize={size}
      aria-expanded={node.branch ? expanded.has(node.id) : undefined} aria-selected={node.checked ?? (node.id === selected)}
      tabIndex={focusId === node.id ? 0 : -1} title={node.title || node.label}
      className={cls('explorer-row', node.branch && 'branch', (node.checked || node.id === selected) && 'selected')}
      style={{ paddingLeft: 8 + depth * 18 }} onFocus={() => setFocus(node.id)}
      onClick={() => { setFocus(node.id); if (node.branch) onToggle(node.id); else onSelect?.(node.id); }}
      onDoubleClick={() => { if (!node.branch) onActivate?.(node.id); }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'ArrowDown') move(rows[index + 1]?.node.id);
        if (e.key === 'ArrowUp') move(rows[index - 1]?.node.id);
        if (e.key === 'Home') move(rows[0]?.node.id);
        if (e.key === 'End') move(rows.at(-1)?.node.id);
        if (e.key === 'ArrowRight' && node.branch) { if (!expanded.has(node.id)) onToggle(node.id); else move(node.children?.[0]?.id); }
        if (e.key === 'ArrowLeft') { if (node.branch && expanded.has(node.id)) onToggle(node.id); else move(parent); }
        if (e.key === 'Enter') { if (node.branch) onToggle(node.id); else (onActivate || onSelect)?.(node.id); }
        if (e.key === ' ') { if (node.branch) onToggle(node.id); else (onCheck || onSelect)?.(node.id); }
      }}>
      <span className="explorer-chevron">{node.loading ? <Spinner size={12} /> : node.branch ? <ChevronRight size={13} className={expanded.has(node.id) ? 'expanded' : ''} /> : null}</span>
      {node.checked !== undefined && onCheck && <input type="checkbox" tabIndex={-1} aria-label={`选择 ${node.label}`} checked={node.checked}
        onClick={(e) => e.stopPropagation()} onChange={() => onCheck(node.id)} />}
      <span className="explorer-icon">{node.icon || (node.branch ? expanded.has(node.id) ? <FolderOpen size={15} /> : <Folder size={15} /> : null)}</span>
      <span className="explorer-name">{node.label}</span>
      {node.meta && <span className="explorer-meta">{node.meta}</span>}
      {node.action && <span className="explorer-action" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>{node.action}</span>}
    </div>)}
  </div>;
}
