import { useMemo, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, FileVideo, MonitorPlay, Search, X } from 'lucide-react';
import { artifactChoices } from '../../shared/artifact-selection';
import { useWb } from '../state';
import { Score, useNamer } from '../components/common';
import { ExplorerTree, type ExplorerNode } from '../components/ExplorerTree';
import { Btn, Empty, IconBtn } from '../ui/kit';
import { isVideo } from '../lib/format';

export function ArtifactTree({ onOpen, picked, onPick }: { onOpen: (ref: string) => void; picked?: Set<string>; onPick?: (ref: string) => void }) {
  const wb = useWb();
  const nm = useNamer();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState('');
  const [searchCollapsed, setSearchCollapsed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const entries = artifactChoices(wb.store?.workspaces || [], wb.store?.runs || []);
    const tasks = new Map<string, Map<string, typeof entries>>();
    for (const entry of entries) {
      const taskName = wb.spec?.tasks.find((t) => t.id === entry.tkey.slice(0, 3))?.name || '';
      const search = `${nm.model(entry.vendor, entry.model)} ${nm.blind ? '' : entry.vendor} ${entry.tkey} ${taskName} r${entry.index} ${entry.harness}`.toLowerCase();
      if (!query.trim().toLowerCase().split(/\s+/).every((word) => search.includes(word))) continue;
      if (!tasks.has(entry.tkey)) tasks.set(entry.tkey, new Map());
      const models = tasks.get(entry.tkey)!;
      const key = `${entry.vendor}/${entry.model}`;
      models.set(key, [...(models.get(key) || []), entry]);
    }
    return [...tasks].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([task, models]): ExplorerNode => ({
      id: 'task:' + task, label: `${task} · ${wb.spec?.tasks.find((t) => t.id === task.slice(0, 3))?.name || '运行产物'}`, branch: true,
      meta: <span>{models.size} 个模型</span>,
      children: [...models].sort((a, b) => nm.model(a[1][0].vendor, a[1][0].model).localeCompare(nm.model(b[1][0].vendor, b[1][0].model))).map(([key, values]) => ({
        id: `model:${task}:${key}`, label: nm.model(values[0].vendor, values[0].model), branch: true,
        meta: <span>{values.length} 次运行</span>,
        children: values.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((entry) => ({
          id: entry.key, label: `r${entry.index ?? '?'} · ${entry.harness || '未指定 harness'}`,
          title: `${nm.model(entry.vendor, entry.model)} / ${task} / r${entry.index ?? '?'}${nm.blind ? '' : '\n' + (entry.ws?.entry || '预览交付目录')}`,
          icon: isVideo(entry.ws?.entry || '') ? <FileVideo size={15} /> : <MonitorPlay size={15} />,
          checked: onPick ? picked?.has(entry.key) || false : undefined,
          meta: entry.run?.score ? <Score v={entry.run.score.total} /> : <span>未评分</span>,
          action: <Btn size="xs" tone="ghost" onClick={() => onOpen(entry.key)}>打开</Btn>,
        })),
      })),
    }));
  }, [wb.store, wb.spec, nm, query, picked, onPick, onOpen]);
  const branches = groups.flatMap((task) => [task.id, ...(task.children || []).map((model) => model.id)]);
  const visibleExpanded = query.trim() ? new Set(branches.filter((id) => !searchCollapsed.has(id))) : expanded;
  const toggle = (id: string) => {
    const set = query.trim() ? setSearchCollapsed : setExpanded;
    set((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  return <div className="artifact-browser">
    <div className="explorer-toolbar">
      <div className="search-in"><Search size={14} /><input aria-label="搜索运行产物" placeholder="搜索题目、AI 模型、轮次…" value={query} onChange={(e) => { setQuery(e.target.value); setSearchCollapsed(new Set()); }} />
        {query && <IconBtn label="清除产物搜索" size="xs" onClick={() => setQuery('')}><X size={12} /></IconBtn>}
      </div>
      <Btn size="xs" tone="ghost" icon={<ChevronsUpDown size={13} />} onClick={() => { setExpanded(new Set(branches)); setSearchCollapsed(new Set()); }}>全部展开</Btn>
      <Btn size="xs" tone="ghost" icon={<ChevronsDownUp size={13} />} onClick={() => { setExpanded(new Set()); setSearchCollapsed(new Set(branches)); }}>全部折叠</Btn>
    </div>
    <div className="explorer-caption"><span>题目 <span aria-hidden>›</span> AI 模型 <span aria-hidden>›</span> 运行轮次</span><span>{query.trim() ? '搜索结果自动展开' : '双击或 Enter 打开产物'}</span></div>
    <ExplorerTree className="artifact-tree" label="运行产物" nodes={groups} expanded={visibleExpanded} onToggle={toggle} selected={selected}
      onSelect={(id) => { setSelected(id); if (onPick && !picked?.has(id)) onPick(id); }} onCheck={onPick} onActivate={onOpen} />
    {!groups.length && <Empty title="没有匹配的运行产物">试试题号或模型名称。</Empty>}
  </div>;
}
