// 预览同屏打分：舞台右侧的玻璃浮层。人工项逐项打分（键盘 0–3 / J K 切换 / N 备注），Agent 项一键复制 AI 评审提示词。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from 'lucide-react';
import type { SpecItem, StoreRun } from '../../shared/types';
import { get, post } from '../api';
import { useWb } from '../state';
import { cls, copyText, fmt } from '../lib/format';
import { Badge, Btn, IconBtn, Kbd } from '../ui/kit';
import { toast } from '../ui/toast';
import { DimChip, Score, useNamer } from './common';

export function ScoreSheet({ runId, onClose }: { runId: string; onClose: () => void }) {
  const wb = useWb();
  const nm = useNamer();
  const run: StoreRun | undefined = wb.store?.runs.find((r) => r.run_id === runId);
  const task = wb.spec?.tasks.find((t) => t.id === run?.task);
  const human = useMemo(() => (run?.score?.items || []).filter((i) => i.method === 'human'), [run]);
  const agentPending = (run?.score?.items || []).filter((i) => i.method === 'agent' && i.status === 'pending').length;
  const firstPending = Math.max(0, human.findIndex((i) => i.status === 'pending'));
  const [idx, setIdx] = useState(firstPending);
  const [min, setMin] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const noteRef = useRef<HTMLInputElement>(null);
  const it = human[idx];
  const spec: SpecItem | undefined = task?.items.find((x) => x.id === it?.id);
  const cur = it ? run?.manual[it.id] : undefined;
  useEffect(() => { setNote(cur?.note || ''); }, [it?.id, cur?.note]);
  const done = human.filter((i) => i.status === 'scored').length;

  const save = async (s: number | null) => {
    if (!it || !run) return;
    setSaving(true);
    try {
      await post(`/api/runs/${encodeURIComponent(run.run_id)}/manual`, { item: it.id, score: s ?? '', note, by: 'human' });
      await wb.refresh(['store', 'agg']);
      if (s != null && idx < human.length - 1) setIdx(idx + 1);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) { if (e.key === 'Escape') (t as HTMLInputElement).blur(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-3]$/.test(e.key)) { e.preventDefault(); void save(Number(e.key)); }
      else if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(human.length - 1, i + 1)); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
      else if (e.key === 'n') { e.preventDefault(); noteRef.current?.focus(); }
      else if (e.key === 'Backspace') { e.preventDefault(); void save(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (!run) return null;
  const aiPrompt = async () => { const r = await get<{ text: string }>('/api/review-prompt', { run_id: run.run_id }); if (await copyText(r.text)) toast.ok('已复制 AI 评审提示词：粘贴给评分 Agent'); };
  const anchors = spec?.anchors.length ? spec.anchors : ['0 分', '1 分', '2 分', '3 分'];
  return (
    <aside className={cls('score-sheet glass-thick', min && 'min')} aria-label="评分面板">
      <header className="ss-h">
        <div className="grow">
          <div className="row gap-s"><b>{task?.id}{run.variant || ''} · {nm.blind ? run.alias || '匿名' : run.model}</b>{run.score && <Score v={run.score.total} />}</div>
          <div className="muted xs">人工项 {done}/{human.length}{agentPending ? ` · Agent 待评 ${agentPending}` : ''}{run.score && !run.score.complete ? ' · 评分未完成' : ''}</div>
        </div>
        <IconBtn label={min ? '展开' : '收起'} size="xs" onClick={() => setMin(!min)}>{min ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</IconBtn>
        <IconBtn label="关闭评分面板" size="xs" onClick={onClose}><X size={14} /></IconBtn>
      </header>
      {!min && (
        <>
          <div className="ss-prog"><i style={{ width: `${human.length ? (done / human.length) * 100 : 100}%` }} /></div>
          {!human.length ? <p className="muted small pad">这道题没有人工项。</p> : it && (
            <div className="ss-b">
              <div className="ss-nav">
                <IconBtn label="上一项 (K)" size="xs" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}><ChevronLeft size={14} /></IconBtn>
                <div className="ss-pills">{human.map((h, i) => <button key={h.id} className={cls('ss-pill', i === idx && 'on', h.status === 'scored' && 'done')} onClick={() => setIdx(i)} aria-label={h.id}>{h.status === 'scored' ? Math.round((h.s || 0) * 3) : ''}</button>)}</div>
                <IconBtn label="下一项 (J)" size="xs" onClick={() => setIdx(Math.min(human.length - 1, idx + 1))} disabled={idx === human.length - 1}><ChevronRight size={14} /></IconBtn>
              </div>
              <div className="row gap-s wrap"><span className="mono xs muted">{it.id}</span><DimChip id={it.dim} />{it.status === 'scored' ? <Badge tone="ok">已评 {fmt.n((it.s || 0) * 3, 0)}</Badge> : <Badge tone="warn">待评</Badge>}</div>
              <p className="ss-desc">{it.desc}</p>
              {spec?.evidence && <p className="muted xs">看什么：{spec.evidence}</p>}
              <div className="ss-anchors" role="radiogroup" aria-label="打分">
                {anchors.map((a, i) => (
                  <button key={i} role="radio" aria-checked={cur?.score === i} className={cls('ss-a', cur?.score === i && 'on', `s${i}`)} disabled={saving} onClick={() => void save(cur?.score === i ? null : i)}>
                    <b>{i}</b><span>{a}</span>{cur?.score === i && <Check size={14} className="ss-ok" />}
                  </button>
                ))}
              </div>
              <input ref={noteRef} className="input sm" placeholder="备注（N 聚焦，Enter 保存）" value={note} onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { void save(cur?.score ?? null); (e.target as HTMLInputElement).blur(); } }} />
              <div className="ss-keys muted xs"><Kbd>0</Kbd>–<Kbd>3</Kbd> 打分 · <Kbd>J</Kbd>/<Kbd>K</Kbd> 切换 · <Kbd>⌫</Kbd> 清除</div>
            </div>
          )}
          {agentPending > 0 && (
            <div className="ss-agent"><Bot size={15} /><span className="grow small">{agentPending} 个 Agent 审查项交给评分 Agent</span><Btn size="xs" tone="tinted" onClick={() => void aiPrompt()}>复制 AI 评审提示词</Btn></div>
          )}
        </>
      )}
    </aside>
  );
}
