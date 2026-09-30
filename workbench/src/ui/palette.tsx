// 命令面板（Ctrl/⌘+K）：跳转视图、模型、运行、题目、预览会话，以及常用任务。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Box, FileCode2, Play, Search, Terminal, Zap } from 'lucide-react';
import { useWb } from '../state';
import { go, type View } from '../lib/router';
import { NAV } from '../nav';

interface Cmd { id: string; group: string; title: string; hint?: string; icon?: ReactNode; keywords?: string; run: () => void }

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wb = useWb();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inp = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inp.current?.focus(), 10); } }, [open]);

  const cmds = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [];
    for (const n of NAV) out.push({ id: 'v:' + n.id, group: '视图', title: n.label, hint: n.key ? `G ${n.key.toUpperCase()}` : undefined, icon: <n.icon size={15} />, keywords: n.id, run: () => go(n.id as View) });
    const job = (title: string, body: Record<string, unknown>, kw = '') => out.push({ id: 'j:' + title, group: '操作', title, icon: <Zap size={15} />, keywords: kw, run: () => void wb.runJob(body, title) });
    job('同步存储文件（重新读取 bench-data 与模型工作区）', { kind: 'sync' }, 'sync refresh');
    job('自动评分：全部未评分运行', { kind: 'grade', all: true, skip_graded: true }, 'grade');
    job('自动评分：全部运行（重新评分）', { kind: 'grade', all: true }, 'grade regrade');
    job('生成评分包（人工 / agent / 用量缺失清单）', { kind: 'review' }, 'review');
    job('导出报表（CSV / Markdown / Excel / PNG / HTML）', { kind: 'export' }, 'export');
    job('评测机依赖检查（doctor）', { kind: 'doctor' }, 'doctor');
    job('rubric 自检', { kind: 'validate' }, 'validate');
    job('生成 T03/T04 统一素材', { kind: 'materials' }, 'materials');
    job('重新生成 benchmark-spec.html', { kind: 'build-spec' }, 'build spec');
    out.push({ id: 'blind', group: '操作', title: wb.blind ? '关闭盲评模式（显示模型名）' : '开启盲评模式（隐藏模型名）', icon: <Zap size={15} />, keywords: 'blind 盲评', run: () => wb.setBlind(!wb.blind) });
    for (const t of wb.spec?.tasks || []) out.push({ id: 't:' + t.id, group: '题目', title: `${t.id} ${t.name}`, hint: t.short, icon: <FileCode2 size={15} />, keywords: t.id.toLowerCase(), run: () => go('spec', [t.id]) });
    for (const m of wb.store?.models || []) out.push({ id: 'm:' + m.vendor + m.name, group: '模型', title: `${m.vendor} / ${m.name}`, hint: m.harness, icon: <Box size={15} />, run: () => go('models', [m.vendor, m.name]) });
    for (const w of (wb.store?.workspaces || []).slice(-200)) out.push({ id: 'w:' + w.ref, group: '运行', title: w.ref, hint: w.harness, icon: <Terminal size={15} />, run: () => go('runs', [w.ref]) });
    for (const p of wb.previews) out.push({ id: 'p:' + p.id, group: '预览', title: p.label, hint: p.url, icon: <Play size={15} />, run: () => go('stage', [], { session: p.id }) });
    return out;
  }, [wb]);

  const res = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return cmds.filter((c) => c.group !== '运行').slice(0, 60);
    const terms = s.split(/\s+/);
    return cmds
      .map((c) => {
        const hay = (c.title + ' ' + (c.hint || '') + ' ' + (c.keywords || '') + ' ' + c.group).toLowerCase();
        if (!terms.every((t) => hay.includes(t))) return null;
        const score = (c.title.toLowerCase().startsWith(terms[0]) ? 0 : 1) + (c.group === '视图' ? 0 : 0.5);
        return { c, score };
      })
      .filter(Boolean)
      .sort((a, b) => a!.score - b!.score)
      .slice(0, 80)
      .map((x) => x!.c);
  }, [q, cmds]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector('[data-sel="1"]')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  if (!open) return null;
  const exec = (c?: Cmd) => { if (!c) return; onClose(); c.run(); };
  let lastGroup = '';
  return (
    <div className="overlay palette-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-label="命令面板">
        <div className="palette-in">
          <Search size={16} aria-hidden />
          <input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索视图、模型、运行、题目或操作…" aria-label="命令"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(res.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); exec(res[sel]); }
              else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }} />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {!res.length && <div className="muted pad">没有匹配项</div>}
          {res.map((c, i) => {
            const head = c.group !== lastGroup ? (lastGroup = c.group) : null;
            return (
              <div key={c.id}>
                {head && <div className="palette-g">{head}</div>}
                <button role="option" aria-selected={i === sel} data-sel={i === sel ? '1' : '0'} className="palette-i" onMouseMove={() => setSel(i)} onClick={() => exec(c)}>
                  <span className="palette-ic">{c.icon}</span>
                  <span className="palette-t">{c.title}</span>
                  {c.hint && <span className="palette-h">{c.hint}</span>}
                  {i === sel && <ArrowRight size={14} className="palette-go" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
