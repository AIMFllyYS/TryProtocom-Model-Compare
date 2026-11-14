// 预览打分：放在左侧栏，不挡住右侧预览。人工项 1–10，选择题或竖轴。
// 旧的 0–3 只显示成 2/4/6/10，点已经亮着的那一档不写盘。改选其他档才按 human-10 保存。
// 再点已选项不清空；清除用退格。
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, ChevronLeft, ChevronRight, Loader2, MessageSquarePlus, PartyPopper } from 'lucide-react';
import type { ManualScore, RunScore, SpecItem, StoreRun } from '../../shared/types';
import { get, post } from '../api';
import { useWb } from '../state';
import { cls, copyText } from '../lib/format';
import { displayLevel, LEVEL_LETTERS, levelBand } from '../lib/humanScale';
import { useLocal } from '../lib/router';
import { Badge, Btn, IconBtn, Kbd } from '../ui/kit';
import { toast } from '../ui/toast';
import { DimChip, Score, useNamer } from './common';

type Answer = { score: number | null; note: string; draft?: boolean; scale?: string };
const ADVANCE_MS = 240;

function levelsOf(spec?: SpecItem): string[] {
  return spec?.levels && spec.levels.length === 10 ? spec.levels : [];
}

export function ScoreSheet({ runId, dock = false }: { runId: string; onClose?: () => void; dock?: boolean }) {
  const wb = useWb();
  const nm = useNamer();
  const run: StoreRun | undefined = wb.store?.runs.find((r) => r.run_id === runId);
  const task = wb.spec?.tasks.find((t) => t.id === run?.task);
  const human = useMemo(() => (run?.score?.items || []).filter((i) => i.method === 'human'), [run?.score]);
  const agentPending = useMemo(() => (run?.score?.items || []).filter((i) => i.method === 'agent' && i.status === 'pending').length, [run?.score]);
  const [mode, setMode] = useLocal<'choice' | 'axis'>('stage.score.input', 'choice');

  const [local, setLocal] = useState<Record<string, Answer>>({});
  const answer = useCallback((id: string): Answer => {
    const l = local[id];
    if (l) return l;
    const m: ManualScore | undefined = run?.manual[id];
    return m ? { score: m.score, note: m.note || '', scale: m.scale } : { score: null, note: '' };
  }, [local, run?.manual]);

  const [idx, setIdx] = useState(() => Math.max(0, human.findIndex((i) => i.status === 'pending')));
  const [noteOpen, setNoteOpen] = useState(false);
  const [inflight, setInflight] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [axisDraft, setAxisDraft] = useState<number | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const advanceTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(advanceTimer.current), []);
  useEffect(() => { setLocal({}); setAxisDraft(null); }, [runId]);

  const it = human[Math.min(idx, Math.max(human.length - 1, 0))];
  const spec: SpecItem | undefined = task?.items.find((x) => x.id === it?.id);
  const cur = it ? answer(it.id) : undefined;
  const shown = cur ? displayLevel(cur.score, cur.scale) : null;
  const scoredCount = human.filter((h) => answer(h.id).score != null).length;
  const allDone = human.length > 0 && scoredCount === human.length;
  useEffect(() => { setNoteOpen(!!cur?.note); setAxisDraft(null); }, [it?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (id: string, score: number | null, note: string, prev: Answer, scale?: string) => {
    setInflight((n) => n + 1);
    queue.current = queue.current.then(async () => {
      try {
        const r = await post<{ score: RunScore; manual: Record<string, ManualScore> }>(`/api/runs/${encodeURIComponent(runId)}/manual`, { item: id, score: score ?? '', note, by: 'human', scale: score == null ? '' : (scale || '') });
        if (r?.score) wb.patchRun(runId, { score: r.score, manual: r.manual });
        setLocal((m) => { const x = m[id]; if (!x || x.draft || x.score !== score || x.note !== note || x.scale !== scale) return m; const c = { ...m }; delete c[id]; return c; });
      } catch (e: any) {
        setLocal((m) => ({ ...m, [id]: prev }));
        toast.error(`${id} 保存失败：${e.message || e}`);
      } finally { setInflight((n) => n - 1); }
    });
  };

  const nextPending = (from: number, scoredId: string) => {
    for (let k = 1; k <= human.length; k++) {
      const j = (from + k) % human.length;
      if (human[j].id !== scoredId && answer(human[j].id).score == null) return j;
    }
    return -1;
  };

  const choose = (s: number | null, opts: { advance?: boolean; note?: string } = {}) => {
    if (!it || !cur) return;
    if (s != null && displayLevel(cur.score, cur.scale) === s) return;
    const prev = cur;
    const note = (opts.note ?? cur.note).trim();
    const scale = s == null ? undefined : 'human-10';
    setLocal((m) => ({ ...m, [it.id]: { score: s, note, scale } }));
    persist(it.id, s, note, prev, scale);
    if (s == null) return;
    setFlash(`${it.id}:${s}`);
    if (opts.advance !== false) {
      const j = nextPending(idx, it.id);
      clearTimeout(advanceTimer.current);
      if (j >= 0) advanceTimer.current = window.setTimeout(() => { setIdx(j); setFlash(null); }, ADVANCE_MS);
    }
  };

  const setNote = (v: string) => { if (it && cur) setLocal((m) => ({ ...m, [it.id]: { score: cur.score, note: v, scale: cur.scale, draft: true } })); };
  const commitNote = () => {
    if (!it || !cur) return;
    const v = cur.note.trim();
    if (cur.score == null) {
      if (/^(10|[1-9])$/.test(v)) choose(Number(v), { note: '' });
      return;
    }
    const saved = run?.manual[it.id];
    setLocal((m) => ({ ...m, [it.id]: { score: cur.score, note: v, scale: cur.scale } }));
    if (v !== (saved?.note || '') || saved?.score !== cur.score) persist(it.id, cur.score, v, { score: saved?.score ?? null, note: saved?.note || '', scale: saved?.scale }, cur.scale);
  };

  const go = (d: number) => { clearTimeout(advanceTimer.current); setFlash(null); setAxisDraft(null); setIdx((i) => Math.max(0, Math.min(human.length - 1, i + d))); };

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) { if (e.key === 'Escape') t.blur(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || !it) return;
    if (e.key === '0') { e.preventDefault(); choose(10); }
    else if (/^[1-9]$/.test(e.key)) { e.preventDefault(); choose(Number(e.key)); }
    else if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); go(1); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); go(-1); }
    else if (e.key === 'n') { e.preventDefault(); setNoteOpen(true); requestAnimationFrame(() => noteRef.current?.focus()); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { if (cur?.score != null) { e.preventDefault(); choose(null); } }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (!run) return null;
  const aiPrompt = async () => { const r = await get<{ text: string }>('/api/review-prompt', { run_id: run.run_id }); if (await copyText(r.text)) toast.ok('已复制 AI 评审提示词：粘贴给评分 Agent'); };
  const levels = levelsOf(spec);
  const axisValue = axisDraft ?? shown ?? 1;
  const axisText = levels[axisValue - 1] || '';

  return (
    <aside className={cls('score-sheet', dock && 'score-dock', !dock && 'glass-thick')} aria-label="评分面板">
      <header className="ss-h">
        <div className="grow">
          <div className="ss-ht"><b>{task?.id}{run.variant || ''}</b><span className="ss-model">{nm.blind ? run.alias || '匿名' : run.model}</span>{run.score && <Score v={run.score.total} />}</div>
          <div className="muted xs">人工 {scoredCount}/{human.length}{inflight > 0 ? <span className="ss-saving"><Loader2 size={11} className="spin" /></span> : run.score && !run.score.complete ? ' · 未完成' : ''}</div>
        </div>
        <IconBtn label={noteOpen ? '收起备注' : '添加备注'} size="xs" active={noteOpen} onClick={() => { setNoteOpen((o) => !o); if (!noteOpen) requestAnimationFrame(() => noteRef.current?.focus()); }}><MessageSquarePlus size={14} /></IconBtn>
      </header>
      <div className="ss-prog"><i style={{ transform: `scaleX(${human.length ? scoredCount / human.length : 1})` }} /></div>
      {!human.length ? <p className="muted small pad">这道题没有人工项。</p> : it && cur && (
        <div className="ss-b">
          <div className="ss-nav">
            <IconBtn label="上一项 (K)" size="xs" onClick={() => go(-1)} disabled={idx === 0}><ChevronLeft size={14} /></IconBtn>
            <Pills items={human} idx={idx} scores={human.map((h) => { const a = answer(h.id); return displayLevel(a.score, a.scale); })} onPick={(i) => { clearTimeout(advanceTimer.current); setFlash(null); setAxisDraft(null); setIdx(i); }} />
            <IconBtn label="下一项 (J)" size="xs" onClick={() => go(1)} disabled={idx === human.length - 1}><ChevronRight size={14} /></IconBtn>
          </div>

          <div className="ss-q">
            <div className="ss-meta">
              <span className="ss-qn">第 {idx + 1} 题</span>
              <span className="mono xs muted">{it.id}</span>
              <DimChip id={it.dim} />
              <div className="ss-mode" role="group" aria-label="作答方式">
                <button type="button" className={cls(mode === 'choice' && 'on')} onClick={() => setMode('choice')}>选择</button>
                <button type="button" className={cls(mode === 'axis' && 'on')} onClick={() => setMode('axis')}>竖轴</button>
              </div>
              {spec?.judge === 'pairwise' && <span className="ss-pair">两两比较</span>}
              {shown != null ? <Badge tone="ok">已选 {shown}</Badge> : <Badge tone="warn">待评</Badge>}
            </div>
            <p className="ss-desc">{it.desc}{spec?.evidence ? <span className="ss-evi"> · {spec.evidence}</span> : null}</p>
            {cur.score != null && cur.scale !== 'human-10' && shown != null && <p className="ss-legacy">旧档亮在 {shown}，改选别的档才按 1–10 重记</p>}
            {noteOpen && (
              <div className="ss-note">
                <textarea ref={noteRef} rows={2} className="input sm" placeholder={cur.score == null ? '备注，选分时一起保存' : '备注，Enter 保存'}
                  value={cur.note} onChange={(e) => setNote(e.target.value)} onBlur={commitNote}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
              </div>
            )}
          </div>

          {levels.length !== 10 ? <p className="muted small">这道题还没有 10 档分辨文案。</p> : mode === 'choice' ? (
            <div className="ss-opts" role="radiogroup" aria-label={`${it.id} 选择 1 到 10 分`}>
              {levels.map((a, i) => {
                const level = i + 1;
                const on = shown === level;
                const band = levelBand(level);
                return (
                  <button key={level} type="button" role="radio" aria-checked={on} className={cls('ss-opt', `s${band}`, on && 'on', on && flash === `${it.id}:${level}` && 'pop')}
                    onClick={() => choose(level, { advance: false })} title={on ? `已选 ${level} 分` : `选 ${level} 分`}>
                    <span className="ss-radio" aria-hidden>{on && <Check size={12} strokeWidth={3} />}</span>
                    <span className="ss-opt-t">{a}</span>
                    <span className="ss-opt-k"><b>{level}</b><i>{LEVEL_LETTERS[i]}</i></span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="ss-axis">
              <input className="ss-range" type="range" min={1} max={10} step={1} value={axisValue} aria-valuemin={1} aria-valuemax={10} aria-valuenow={axisValue} aria-valuetext={axisText}
                onChange={(e) => setAxisDraft(Number(e.target.value))}
                onPointerUp={(e) => { const n = Number((e.target as HTMLInputElement).value); setAxisDraft(null); choose(n, { advance: false }); }}
                onKeyUp={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.stopPropagation(); const n = Number((e.target as HTMLInputElement).value); setAxisDraft(null); choose(n, { advance: false }); } }}
                onBlur={(e) => { if (axisDraft != null) { const n = Number(e.target.value); setAxisDraft(null); choose(n, { advance: false }); } }} />
              <div className="ss-axis-read">
                <b>{shown == null && axisDraft == null ? '—' : axisValue}</b>
                <span className="muted xs">{LEVEL_LETTERS[axisValue - 1]} · {axisValue} 分</span>
                <p>{axisText}</p>
              </div>
            </div>
          )}
          {allDone && <div className="ss-done"><PartyPopper size={14} /><span className="small">人工项已评完{inflight ? '，正在保存…' : ''}</span></div>}
        </div>
      )}
      <div className="ss-keys">
        <span><Kbd>1</Kbd>–<Kbd>9</Kbd> 打分</span>
        <span><Kbd>0</Kbd> 即 10</span>
        <span><Kbd>J</Kbd><Kbd>K</Kbd> 切题</span>
      </div>
      {agentPending > 0 && (
        <div className="ss-agent"><Bot size={14} /><span className="grow small">{agentPending} 个 Agent 项仍是 0–3</span><Btn size="xs" tone="tinted" onClick={() => void aiPrompt()}>复制提示词</Btn></div>
      )}
    </aside>
  );
}

const Pills = memo(function Pills({ items, idx, scores, onPick }: { items: { id: string }[]; idx: number; scores: (number | null)[]; onPick: (i: number) => void }) {
  return (
    <div className="ss-pills">
      {items.map((h, i) => (
        <button key={h.id} type="button" className={cls('ss-pill', i === idx && 'on', scores[i] != null && 'done', scores[i] != null && `s${levelBand(scores[i]!)}`)} onClick={() => onPick(i)} aria-label={`${h.id}${scores[i] != null ? ` · ${scores[i]} 分` : ' · 待评'}`}>
          {scores[i] ?? ''}
        </button>
      ))}
    </div>
  );
}, (a, b) => a.idx === b.idx && a.items === b.items && a.scores.join() === b.scores.join());
