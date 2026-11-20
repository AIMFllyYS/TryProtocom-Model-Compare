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
import { Badge, IconBtn, Kbd } from '../ui/kit';
import { toast } from '../ui/toast';
import { DimChip, useNamer } from './common';

type Answer = { score: number | null; note: string; draft?: boolean; scale?: string };
const ADVANCE_MS = 240;
const scoreSaves = new Map<string, Promise<void>>();

function levelsOf(spec?: SpecItem): string[] {
  return spec?.levels && spec.levels.length === 10 ? spec.levels : [];
}

export function ScoreSheet({ runId, active }: { runId: string; active: boolean }) {
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
  const advanceTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(advanceTimer.current), []);
  useEffect(() => { if (!active) clearTimeout(advanceTimer.current); }, [active]);

  const it = human[Math.min(idx, Math.max(human.length - 1, 0))];
  const spec: SpecItem | undefined = task?.items.find((x) => x.id === it?.id);
  const cur = it ? answer(it.id) : undefined;
  const shown = cur ? displayLevel(cur.score, cur.scale) : null;
  const scoredCount = human.filter((h) => answer(h.id).score != null).length;
  const allDone = human.length > 0 && scoredCount === human.length;
  useEffect(() => { setNoteOpen(!!cur?.note); setAxisDraft(null); }, [it?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (id: string, submitted: Answer) => {
    const { score, note, scale } = submitted;
    setInflight((n) => n + 1);
    const save = (scoreSaves.get(runId) ?? Promise.resolve()).then(async () => {
      try {
        const r = await post<{ score: RunScore; manual: Record<string, ManualScore> }>(`/api/runs/${encodeURIComponent(runId)}/manual`, { item: id, score: score ?? '', note, by: 'human', scale: score == null ? '' : (scale || '') });
        if (!r?.score || !r.manual) throw new Error('未收到最新评分结果');
        wb.patchRun(runId, { score: r.score, manual: r.manual });
      } catch (e: any) {
        toast.error(`${id} 保存失败：${e.message || e}`);
      } finally {
        setLocal((m) => {
          if (m[id] !== submitted) return m;
          const next = { ...m };
          delete next[id];
          return next;
        });
        setInflight((n) => n - 1);
      }
    });
    scoreSaves.set(runId, save);
    void save.then(() => { if (scoreSaves.get(runId) === save) scoreSaves.delete(runId); });
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
    const note = (opts.note ?? cur.note).trim();
    const scale = s == null ? undefined : 'human-10';
    const submitted = { score: s, note, scale };
    setLocal((m) => ({ ...m, [it.id]: submitted }));
    persist(it.id, submitted);
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
    if (!it || !cur?.draft) return;
    const v = cur.note.trim();
    if (cur.score == null) {
      if (/^(10|[1-9])$/.test(v)) choose(Number(v), { note: '' });
      return;
    }
    const saved = run?.manual[it.id];
    if (v === (saved?.note || '') && saved?.score === cur.score && saved?.scale === cur.scale && !inflight) {
      setLocal((m) => { const next = { ...m }; delete next[it.id]; return next; });
      return;
    }
    const submitted = { score: cur.score, note: v, scale: cur.scale };
    setLocal((m) => ({ ...m, [it.id]: submitted }));
    persist(it.id, submitted);
  };

  const go = (d: number) => { clearTimeout(advanceTimer.current); setFlash(null); setAxisDraft(null); setIdx((i) => Math.max(0, Math.min(human.length - 1, i + d))); };

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (!active || e.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    const t = e.target as HTMLElement;
    if (t?.closest('.vplayer, [role="listbox"], [role="tree"]')) return;
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
    if (!active) return;
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active]);

  if (!run) return null;
  const aiPrompt = async () => { const r = await get<{ text: string }>('/api/review-prompt', { run_id: run.run_id }); if (await copyText(r.text)) toast.ok('已复制 AI 评审提示词：粘贴给评分 Agent'); };
  const levels = levelsOf(spec);
  const axisValue = axisDraft ?? shown ?? 1;
  const axisText = levels[axisValue - 1] || '';

  return (
    <aside className="score-sheet score-dock" aria-label="评分面板">
      <header className="ss-h">
        <div className="grow">
          <div className="ss-ht"><b>{run.tkey}</b><span className="ss-model">{nm.blind ? run.alias || '匿名' : run.model}</span><span className="muted xs nowrap">r{run.run_index ?? '?'}</span></div>
          <div className="muted xs">人工 {scoredCount}/{human.length}{inflight > 0 && <span className="ss-saving" role="status"><Loader2 size={11} className="spin" />保存中</span>}</div>
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
        {agentPending > 0 && <IconBtn className="ss-agent-copy" size="xs" label="复制 Agent 评分提示词" onClick={() => void aiPrompt()}><Bot size={14} /></IconBtn>}
      </div>
      {run.score && <ScoreSummary score={run.score} />}
    </aside>
  );
}

function ScoreSummary({ score }: { score: RunScore }) {
  let weight = 0, points = 0, pending = 0;
  for (const item of score.items) {
    if (item.method !== 'auto' && item.method !== 'agent') continue;
    if (item.status === 'pending') pending++;
    if (!Number.isFinite(item.weight) || item.weight <= 0) continue;
    if (item.status === 'missing') weight += item.weight;
    else if (item.status === 'scored' && item.s != null && Number.isFinite(item.s)) {
      weight += item.weight;
      points += item.s * item.weight;
    }
  }
  const gated = !score.gate_pass;
  const capped = !!(score.capped || score.tier0_fail?.length);
  const complete = score.complete && !score.items.some((item) => item.status === 'pending');
  return <div className="ss-summary" role="group" aria-label="评分摘要" aria-live="polite">
    <div className="ss-summary-segment ss-summary-total">
      <span className="ss-summary-label">当前总分</span>
      <strong className="ss-summary-number">{Number.isFinite(score.total) ? score.total.toFixed(1) : '—'}</strong>
      <div className="ss-summary-status">
        {!complete && <span>未评完</span>}
        {gated && <span className="ss-summary-alert">门槛未通过</span>}
        {capped && <span className="ss-summary-alert">封顶{score.cap_value != null ? ` ${score.cap_value}` : ''}</span>}
        {complete && !gated && !capped && <span>已评完</span>}
      </div>
    </div>
    <div className="ss-summary-segment">
      <span className="ss-summary-label">其他项总分</span>
      <strong className="ss-summary-number">{weight > 0 ? (100 * points / weight).toFixed(1) : '—'}</strong>
      <div className="ss-summary-status"><span>脚本 + Agent</span>{pending > 0 && <span>{pending} 项待评</span>}</div>
    </div>
  </div>;
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
