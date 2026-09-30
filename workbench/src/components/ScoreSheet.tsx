// 预览同屏打分：舞台右侧的玻璃浮层。人工项按“选择题”逐项作答（点选项或按 0–3），Agent 项一键复制 AI 评审提示词。
//
// 交互与性能要点：
// - 乐观更新：点下选项立刻显示选中并自动跳到下一道待评项，保存在后台按顺序排队，失败才回滚并提示。
//   以前每次点击都要等 Python 桥接重新计分 + 两次全量刷新才有反应，所以显得“点了没反应”。
// - 备注挂在分数上保存（bench-grader 的人工分以分数为主键）。还没选分时写的备注作为草稿保留在该题上，
//   选分时一起保存；草稿只写了一个 0–3 的数字并回车，就当作选这个分。
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, MessageSquarePlus, PartyPopper, X } from 'lucide-react';
import type { ManualScore, RunScore, SpecItem, StoreRun } from '../../shared/types';
import { get, post } from '../api';
import { useWb } from '../state';
import { cls, copyText } from '../lib/format';
import { Badge, Btn, IconBtn, Kbd } from '../ui/kit';
import { toast } from '../ui/toast';
import { DimChip, Score, useNamer } from './common';

type Answer = { score: number | null; note: string; draft?: boolean };
const ADVANCE_MS = 240; // 让选中态先被看见，再跳下一题

export function ScoreSheet({ runId, onClose }: { runId: string; onClose: () => void }) {
  const wb = useWb();
  const nm = useNamer();
  const run: StoreRun | undefined = wb.store?.runs.find((r) => r.run_id === runId);
  const task = wb.spec?.tasks.find((t) => t.id === run?.task);
  const human = useMemo(() => (run?.score?.items || []).filter((i) => i.method === 'human'), [run?.score]);
  const agentPending = useMemo(() => (run?.score?.items || []).filter((i) => i.method === 'agent' && i.status === 'pending').length, [run?.score]);

  // 本地作答（乐观值 / 草稿），覆盖服务端的 run.manual
  const [local, setLocal] = useState<Record<string, Answer>>({});
  const answer = useCallback((id: string): Answer => {
    const l = local[id];
    if (l) return l;
    const m: ManualScore | undefined = run?.manual[id];
    return m ? { score: m.score, note: m.note || '' } : { score: null, note: '' };
  }, [local, run?.manual]);

  const [idx, setIdx] = useState(() => Math.max(0, human.findIndex((i) => i.status === 'pending')));
  const [min, setMin] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [inflight, setInflight] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const advanceTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(advanceTimer.current), []);
  useEffect(() => { setLocal({}); }, [runId]);

  const it = human[Math.min(idx, human.length - 1)];
  const spec: SpecItem | undefined = task?.items.find((x) => x.id === it?.id);
  const cur = it ? answer(it.id) : undefined;
  const scoredCount = human.filter((h) => answer(h.id).score != null).length;
  const allDone = human.length > 0 && scoredCount === human.length;
  useEffect(() => { setNoteOpen(!!cur?.note); }, [it?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 后台顺序保存；成功后用返回的分数就地更新存储，失败回滚这一题 */
  const persist = (id: string, score: number | null, note: string, prev: Answer) => {
    setInflight((n) => n + 1);
    queue.current = queue.current.then(async () => {
      try {
        const r = await post<{ score: RunScore; manual: Record<string, ManualScore> }>(`/api/runs/${encodeURIComponent(runId)}/manual`, { item: id, score: score ?? '', note, by: 'human' });
        if (r?.score) wb.patchRun(runId, { score: r.score, manual: r.manual });
        // 服务端已确认：丢掉这题的乐观值（除非用户在保存期间又改了它）
        setLocal((m) => { const x = m[id]; if (!x || x.draft || x.score !== score || x.note !== note) return m; const c = { ...m }; delete c[id]; return c; });
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
    const prev = cur;
    const note = (opts.note ?? cur.note).trim();
    setLocal((m) => ({ ...m, [it.id]: { score: s, note } }));
    persist(it.id, s, note, prev);
    if (s == null) return;
    setFlash(`${it.id}:${s}`);
    if (opts.advance !== false) {
      const j = nextPending(idx, it.id);
      clearTimeout(advanceTimer.current);
      if (j >= 0) advanceTimer.current = window.setTimeout(() => { setIdx(j); setFlash(null); }, ADVANCE_MS);
    }
  };

  // 正在编辑的备注一律标为草稿：保存成功的回执不会把它冲掉
  const setNote = (v: string) => { if (it && cur) setLocal((m) => ({ ...m, [it.id]: { score: cur.score, note: v, draft: true } })); };
  const commitNote = () => {
    if (!it || !cur) return;
    const v = cur.note.trim();
    if (cur.score == null) {
      if (/^[0-3]$/.test(v)) choose(Number(v), { note: '' }); // 习惯在备注里敲分数：当作选这个分
      return; // 其余：草稿留在这题上，选分时一起保存
    }
    const saved = run?.manual[it.id];
    setLocal((m) => ({ ...m, [it.id]: { score: cur.score, note: v } }));
    if (v !== (saved?.note || '') || saved?.score !== cur.score) persist(it.id, cur.score, v, { score: saved?.score ?? null, note: saved?.note || '' });
  };

  const go = (d: number) => { clearTimeout(advanceTimer.current); setFlash(null); setIdx((i) => Math.max(0, Math.min(human.length - 1, i + d))); };

  // 键盘：用 ref 拿最新处理函数，监听器只挂一次
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) { if (e.key === 'Escape') t.blur(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || min || !it) return;
    if (/^[0-3]$/.test(e.key)) { e.preventDefault(); choose(Number(e.key)); }
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
  const anchors = spec?.anchors.length ? spec.anchors : ['0 分', '1 分', '2 分', '3 分'];

  return (
    <aside className={cls('score-sheet glass-thick', min && 'min')} aria-label="评分面板">
      <header className="ss-h">
        <div className="grow">
          <div className="row gap-s"><b>{task?.id}{run.variant || ''} · {nm.blind ? run.alias || '匿名' : run.model}</b>{run.score && <Score v={run.score.total} />}</div>
          <div className="muted xs row gap-xs">
            人工项 {scoredCount}/{human.length}{agentPending ? ` · Agent 待评 ${agentPending}` : ''}
            {inflight > 0 ? <span className="ss-saving"><Loader2 size={11} className="spin" />保存中</span> : run.score && !run.score.complete ? ' · 评分未完成' : ''}
          </div>
        </div>
        <IconBtn label={min ? '展开' : '收起'} size="xs" onClick={() => setMin(!min)}>{min ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</IconBtn>
        <IconBtn label="关闭评分面板" size="xs" onClick={onClose}><X size={14} /></IconBtn>
      </header>
      {!min && (
        <>
          <div className="ss-prog"><i style={{ transform: `scaleX(${human.length ? scoredCount / human.length : 1})` }} /></div>
          {!human.length ? <p className="muted small pad">这道题没有人工项。</p> : it && cur && (
            <div className="ss-b">
              <div className="ss-nav">
                <IconBtn label="上一项 (K)" size="xs" onClick={() => go(-1)} disabled={idx === 0}><ChevronLeft size={14} /></IconBtn>
                <Pills items={human} idx={idx} scores={human.map((h) => answer(h.id).score)} onPick={(i) => { clearTimeout(advanceTimer.current); setFlash(null); setIdx(i); }} />
                <IconBtn label="下一项 (J)" size="xs" onClick={() => go(1)} disabled={idx === human.length - 1}><ChevronRight size={14} /></IconBtn>
              </div>

              <div className="ss-q">
                <div className="row gap-s wrap">
                  <span className="ss-qn">第 {idx + 1} 题</span><span className="mono xs muted">{it.id}</span><DimChip id={it.dim} />
                  {cur.score != null ? <Badge tone="ok">已选 {cur.score}</Badge> : <Badge tone="warn">待评</Badge>}
                </div>
                <p className="ss-desc">{it.desc}</p>
                {spec?.evidence && <p className="ss-evi">看什么：{spec.evidence}</p>}
              </div>

              <div className="ss-opts" role="radiogroup" aria-label={`${it.id} 选择分数`}>
                {anchors.map((a, i) => {
                  const on = cur.score === i;
                  return (
                    <button key={i} type="button" role="radio" aria-checked={on} className={cls('ss-opt', `s${i}`, on && 'on', on && flash === `${it.id}:${i}` && 'pop')}
                      onClick={() => choose(on ? null : i)} title={on ? '再点一次取消' : `选 ${i} 分（键盘 ${i}）`}>
                      <span className="ss-radio" aria-hidden>{on && <Check size={12} strokeWidth={3} />}</span>
                      <span className="ss-opt-t">{a}</span>
                      <span className="ss-opt-k">{i}</span>
                    </button>
                  );
                })}
              </div>

              {noteOpen ? (
                <div className="ss-note">
                  <textarea ref={noteRef} rows={2} className="input sm" placeholder={cur.score == null ? '备注（先写也行，选分时一起保存）' : '备注（Enter 保存，Shift+Enter 换行）'}
                    value={cur.note} onChange={(e) => setNote(e.target.value)} onBlur={commitNote}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
                  {cur.score == null && cur.note.trim() && <span className="muted xs">草稿 · 选分时一起保存</span>}
                </div>
              ) : (
                <button type="button" className="ss-note-add" onClick={() => { setNoteOpen(true); requestAnimationFrame(() => noteRef.current?.focus()); }}>
                  <MessageSquarePlus size={13} />添加备注（可选）<Kbd>N</Kbd>
                </button>
              )}

              {allDone && (
                <div className="ss-done"><PartyPopper size={15} /><span className="grow small">人工项全部评完{inflight ? '，正在保存…' : ''}</span></div>
              )}
              <div className="ss-keys muted xs"><Kbd>0</Kbd>–<Kbd>3</Kbd> 作答 · <Kbd>J</Kbd>/<Kbd>K</Kbd> 切题 · <Kbd>⌫</Kbd> 清除 · 再点已选项取消</div>
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

const Pills = memo(function Pills({ items, idx, scores, onPick }: { items: { id: string }[]; idx: number; scores: (number | null)[]; onPick: (i: number) => void }) {
  return (
    <div className="ss-pills">
      {items.map((h, i) => (
        <button key={h.id} type="button" className={cls('ss-pill', i === idx && 'on', scores[i] != null && `done s${scores[i]}`)} onClick={() => onPick(i)} aria-label={`${h.id}${scores[i] != null ? ` · ${scores[i]} 分` : ' · 待评'}`}>
          {scores[i] ?? ''}
        </button>
      ))}
    </div>
  );
}, (a, b) => a.idx === b.idx && a.items === b.items && a.scores.join() === b.scores.join());
