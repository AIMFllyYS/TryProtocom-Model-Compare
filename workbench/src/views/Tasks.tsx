// 题目：顶部 Tab 选题 → 一键复制带统一运行约定的提示词（自动建工作目录、开始计时、可选打开 harness）→ 交付要求与评分细则。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, ClipboardCopy, Clock3, Copy, ExternalLink, FileCheck2, FolderOpen, Info, ListChecks, Lock, Package, Search, ShieldCheck, TriangleAlert, Users } from 'lucide-react';
import type { SpecItem, SpecTask, WorkspaceRun } from '../../shared/types';
import { deliverableFor, FINAL_FILE } from '../../shared/deliverables';
import { get, post } from '../api';
import { useWb } from '../state';
import { go, href, useLocal, useRoute } from '../lib/router';
import { cls, copyText, fmt, METHOD_LABEL, TIER_LABEL, wsStatus } from '../lib/format';
import { Badge, Btn, Card, CopyBtn, Empty, SearchInput, Seg, Switch, TabBar, Tip } from '../ui/kit';
import { Donut } from '../ui/charts';
import { toast } from '../ui/toast';
import { HarnessIcon } from '../ui/brand';
import { DimChip, Score, WsBadge } from '../components/common';
import { HarnessPicker, ModelPicker, findHarness } from '../components/pickers';

interface PromptRes { text: string; warnings: string[]; ref: string | null; workspace: string | null; index: number | null; exists: boolean }

export default function Tasks() {
  const wb = useWb();
  const route = useRoute();
  const tasks = wb.spec?.tasks || [];
  const id = (route.parts[0] || tasks[0]?.id || 'T01').toUpperCase();
  const t = tasks.find((x) => x.id === id) || tasks[0];
  const [cur] = [wb.current];
  const runsOf = (tid: string) => (wb.store?.workspaces || []).filter((w) => `${w.vendor}/${w.model}` === cur && w.task === tid);
  if (!wb.spec) return <div className="page"><div className="skel" style={{ height: 420 }} /></div>;
  if (!t) return <div className="page"><Empty title="题库为空">没有读取到 bench-grader 的题目。</Empty></div>;
  const need = wb.spec.cfg.runs_per_task;
  return (
    <div className="page tasks-page">
      <div className="task-tabs-wrap">
        <TabBar value={t.id} onChange={(v) => go('tasks', [v])} label="题目" className="task-tabs" tabs={tasks.map((x) => {
          const n = runsOf(x.id).filter((w) => w.grader_run_id || w.detect?.final || w.ended_at).length;
          return { value: x.id, title: x.short, label: <span className="tt"><b>{x.id}</b><span>{x.name.replace(/（.*?）/g, '')}</span></span>, badge: cur ? <span className={cls('tt-dots')}>{Array.from({ length: need }, (_, i) => <i key={i} className={cls(i < n && 'on')} />)}</span> : undefined };
        })} />
      </div>
      <TaskView key={t.id} t={t} />
    </div>
  );
}

function TaskView({ t }: { t: SpecTask }) {
  const wb = useWb();
  const route = useRoute();
  const variants = Object.keys(t.variants || {});
  const [variant, setVariant] = useLocal<string>(`task.variant.${t.id}`, variants[0] || '');
  const v = variants.length ? variant || variants[0] : null;
  const [vendor, model] = wb.current ? [wb.current.split('/')[0], wb.current.split('/').slice(1).join('/')] : [null, null];
  const prof = wb.store?.models.find((m) => m.vendor === vendor && m.name === model);
  const [harness, setHarness] = useState(prof?.harness || '');
  useEffect(() => { setHarness(prof?.harness || findHarness(wb.store?.settings.default_harness)?.name || ''); }, [prof?.harness, wb.current]); // eslint-disable-line
  const [pr, setPr] = useState<PromptRes | null>(null);
  const [copied, setCopied] = useState<{ ref: string; ws: string; opened?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const settings = wb.store?.settings || {};
  const autoStart = settings.auto_start !== false;
  const d = deliverableFor(t.id, t.deliverable);
  const runs = (wb.store?.workspaces || []).filter((w) => w.vendor === vendor && w.model === model && w.task === t.id && (!v || w.variant === v));
  const load = useCallback(() => {
    get<PromptRes>('/api/ws/prompt', { task: t.id, variant: v || undefined, for: wb.current || undefined }).then(setPr, (e) => setPr({ text: '', warnings: [e.message], ref: null, workspace: null, index: null, exists: false }));
  }, [t.id, v, wb.current, settings.prompt_header, settings.tts_command]); // eslint-disable-line
  useEffect(load, [load, wb.store?.workspaces.length]);
  useEffect(() => { setCopied(null); }, [t.id, v, wb.current]);

  const dispatch = async (open: boolean) => {
    if (!pr?.text) return;
    if (!vendor || !model) {
      if (await copyText(pr.text)) toast.info('已复制（未选择测评模型：提示词里没有工作目录。先在右上角选择或新增模型）');
      return;
    }
    await copyText(pr.text); // 先在用户手势内复制，保证剪贴板可写
    setBusy(true);
    try {
      const r = await post<{ run: WorkspaceRun; text: string; opened: string | null }>('/api/ws/claim', { vendor, model, task: t.id, variant: v, index: pr.index, start: autoStart, harness, open });
      if (r.text !== pr.text) { await copyText(r.text); toast.warn('工作目录序号有变化，已复制更新后的提示词'); }
      setCopied({ ref: r.run.ref, ws: r.run.workspace || '', opened: r.opened });
      if (harness && harness !== prof?.harness && prof) void post('/api/models', { ...prof, harness });
      toast.ok(`已复制提示词 · 工作目录 ${r.run.ref.split('/').slice(2).join('/')} 已就绪${autoStart ? '，开始计时' : ''}`, { action: { label: '查看运行', run: () => go('runs', [r.run.ref]) } });
      if (r.opened) toast.info(r.opened);
      await wb.refresh(['store']);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
      if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey && window.getSelection()?.toString() === '') { e.preventDefault(); void dispatch(false); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const hdef = findHarness(harness);
  const hInstalled = hdef ? wb.harness.find((h) => h.id === hdef.id)?.installed : false;
  const need = wb.spec!.cfg.runs_per_task;
  const done = runs.filter((w) => w.grader_run_id || w.detect?.final || w.ended_at).length;
  const tab = route.query.get('tab') || 'prompt';

  return (
    <div className="task-grid">
      <div className="stack l">
        <section className="dispatch glass">
          <div className="dispatch-h">
            <div className="task-badge">{t.id}{v || ''}</div>
            <div className="grow">
              <h1 className="dispatch-t">{t.name}</h1>
              <p className="dim">{t.short}</p>
            </div>
          </div>
          <div className="chips mt">
            {t.time_limit && <span className="chip"><Clock3 size={12} />{t.time_limit} 分钟</span>}
            <span className="chip"><Users size={12} />{/有人值守/.test(t.condition) ? '有人值守' : '无人值守'}</span>
            <span className="chip"><Package size={12} />{d.kind === 'repo' ? '修改' : '新建'} {d.dir}/</span>
            <span className="chip"><ListChecks size={12} />{t.items.length} 个检查项</span>
            {Object.entries(v ? t.variants[v].dims : t.dims).map(([k, w]) => <DimChip key={k} id={k} w={w} />)}
          </div>
          {variants.length > 0 && (
            <div className="variant-row">
              <Seg value={v!} onChange={setVariant} options={variants.map((x) => ({ value: x, label: `${x} 组` }))} label="对照组" />
              <span className="muted small">{t.variants[v!]?.desc}</span>
            </div>
          )}
          <div className="dispatch-for">
            <div className="for-l">为</div>
            <ModelPicker value={wb.current} onChange={wb.setCurrent} />
            <div className="for-l">在</div>
            <HarnessPicker value={harness} onChange={setHarness} />
            <div className="for-l">中测评</div>
          </div>
          <div className="dispatch-cta">
            <Btn tone="primary" size="xl" icon={busy ? undefined : <ClipboardCopy size={18} />} busy={busy} onClick={() => void dispatch(false)} disabled={!pr?.text} kbd="C">复制提示词</Btn>
            {hdef && hInstalled && <Btn size="xl" icon={<HarnessIcon name={harness} size="xs" />} onClick={() => void dispatch(true)} disabled={!pr?.text || !vendor}>复制并打开 {hdef.name}</Btn>}
          </div>
          <div className="dispatch-meta">
            {vendor ? (
              <><FolderOpen size={13} /><span className="mono ellipsis" title={pr?.workspace || ''}>{pr?.workspace ? pr.workspace.split(/[\\/]/).slice(-4).join('\\') : '…'}</span>
                <Badge tone={pr?.exists ? 'info' : 'accent'}>{pr?.exists ? '复用未开始的工作目录' : `新建 r${pr?.index ?? '?'}`}</Badge>
                {autoStart && <span className="muted">复制即开始计时</span>}</>
            ) : <span className="row gap-s tone-text-warn"><Info size={13} />先选择测评模型：提示词会写入该模型的工作目录绝对路径。</span>}
          </div>
          {pr?.warnings.map((w, i) => <div key={i} className="alert warn mt-s"><TriangleAlert size={14} />{w}</div>)}
          {copied && (
            <div className="copied glass-thin">
              <span className="copied-ic"><Check size={16} strokeWidth={3} /></span>
              <div className="grow"><b>已复制，粘贴给 {harness || '被测模型'} 即可开始</b><div className="muted small">模型完成后写出 <code>{FINAL_FILE}</code>，工作台会自动结束计时并点亮交付清单。</div></div>
              <Btn size="sm" icon={<FolderOpen size={14} />} onClick={() => void post('/api/open-folder', { ref: copied.ref })}>工作目录</Btn>
              <Btn size="sm" tone="tinted" iconRight={<ArrowRight size={14} />} onClick={() => go('runs', [copied.ref])}>跟踪运行</Btn>
            </div>
          )}
        </section>

        <Card title={<span className="row gap-s">提示词<span className="badge">{pr ? `${pr.text.split('\n').length} 行` : '…'}</span></span>} extra={<>
          <Seg size="xs" value={tab} onChange={(x) => go('tasks', [t.id], { tab: x }, true)} options={[{ value: 'prompt', label: '最终提示词' }, { value: 'raw', label: '题目原文' }, { value: 'rubric', label: '评分细则' }]} />
          {tab !== 'rubric' && <CopyBtn text={tab === 'raw' ? t.prompt : pr?.text || ''} size="sm" tone="ghost" />}
        </>}>
          {tab === 'prompt' && <PromptView text={pr?.text || ''} />}
          {tab === 'raw' && <pre className="prompt">{t.prompt}</pre>}
          {tab === 'rubric' && <Rubric t={t} variant={v} />}
        </Card>
      </div>

      <div className="stack l task-side">
        <Card title="交付要求" sub={d.kind === 'repo' ? '直接修改预置项目' : '名称必须完全一致'}>
          <div className="deliv">
            <div className="deliv-root mono"><Package size={14} />{d.dir}/</div>
            {d.files.map((f) => <div key={f.path} className={cls('deliv-f', f.optional && 'opt')}><FileCheck2 size={14} /><span className="mono">{f.any ? f.label : f.path + (f.dir ? '/' : '')}</span>{!f.any && f.label && f.label !== f.path && <span className="muted xs">{f.label}</span>}{f.optional && <Badge>可选</Badge>}</div>)}
            <div className="deliv-f fin"><FileCheck2 size={14} /><span className="mono">{FINAL_FILE}</span><span className="muted xs">工作目录根，最后回复原文</span></div>
          </div>
          {t.materials.length > 0 && <div className="mt"><div className="field-l">预置素材（自动复制到工作目录）</div><ul className="plain-list">{t.materials.map((m) => <li key={m} className="mono small">{m.replace(/^materials\//, '')}</li>)}</ul></div>}
          <div className="alert mt"><Lock size={14} />隐藏测试、参考实现与意图表不会进入工作目录；工作目录是独立 git 根，被测 Agent 找不到评分 skill。</div>
        </Card>

        <Card title="本模型的运行" sub={vendor ? `规范要求 ${need} 次` : undefined} extra={vendor ? <span className="ring-lite">{done}/{need}</span> : undefined}>
          {!vendor ? <p className="muted small">选择测评模型后显示该模型在本题的运行。</p> : !runs.length ? <p className="muted small">还没有运行。点「复制提示词」会自动创建 r1。</p> : (
            <div className="mini-runs">
              {runs.map((w) => {
                const r = w.grader_run_id ? wb.store?.runs.find((x) => x.run_id === w.grader_run_id) : undefined;
                return (
                  <a key={w.ref} className="mini-run" href={href('runs', [w.ref])}>
                    <b className="mono">r{w.index}</b>
                    <WsBadge w={{ ...w, status: r?.graded ? 'graded' : w.grader_run_id ? 'registered' : wsStatus(w) }} />
                    <span className="grow muted xs ellipsis">{w.detect ? `交付 ${w.detect.done}/${w.detect.total}` : ''}{w.started_at ? ` · ${fmt.ago(w.started_at)}` : ''}</span>
                    {r?.score ? <Score v={r.score.total} /> : <ArrowRight size={14} className="muted" />}
                  </a>
                );
              })}
            </div>
          )}
        </Card>

        <Composition t={t} />
        <Card title="门槛条件" sub="任一不过，该次运行记 0 分">
          <ul className="gates">{t.gates.filter((g) => !g.variants.length || !v || g.variants.includes(v)).map((g) => <li key={g.id}><ShieldCheck size={14} /><span><b className="mono">{g.id}</b> {g.desc}</span></li>)}</ul>
        </Card>
      </div>
    </div>
  );
}

/** 提示词：运行约定头高亮显示 */
function PromptView({ text }: { text: string }) {
  if (!text) return <div className="skel" style={{ height: 260 }} />;
  const i = text.indexOf('\n---\n');
  const head = text.startsWith('# 运行约定') && i > 0 ? text.slice(0, i) : '';
  const body = head ? text.slice(i + 5) : text;
  return (
    <div className="prompt-view">
      {head && <pre className="prompt-head">{head}</pre>}
      <pre className="prompt">{body.replace(/^\s+/, '')}</pre>
    </div>
  );
}

function Composition({ t }: { t: SpecTask }) {
  const by = (k: 'method' | 'tier') => {
    const m = new Map<string, number>();
    for (const i of t.items) m.set(i[k], (m.get(i[k]) || 0) + 1);
    return m;
  };
  const meth = by('method'), tier = by('tier');
  const MC: Record<string, string> = { auto: 'var(--info)', agent: 'var(--accent)', human: 'var(--d-anim)' };
  const TC: Record<string, string> = { basic: 'var(--text-4)', advanced: 'var(--info)', excellent: 'var(--accent)', clean: 'var(--warn)' };
  return (
    <Card title="评分构成">
      <div className="compo">
        <div className="compo-c"><Donut size={120} thick={14} center={t.items.length} sub="检查项" parts={[...meth].map(([k, n]) => ({ label: METHOD_LABEL[k as keyof typeof METHOD_LABEL] || k, value: n, color: MC[k] || 'var(--text-3)' }))} /></div>
        <div className="grow stack s">
          <div className="legend-list">{[...meth].map(([k, n]) => <span key={k}><i style={{ background: MC[k] }} />{METHOD_LABEL[k as keyof typeof METHOD_LABEL]}<b>{n}</b></span>)}</div>
          <div className="hair" />
          <div className="legend-list">{[...tier].map(([k, n]) => <span key={k}><i style={{ background: TC[k] }} />{TIER_LABEL[k as keyof typeof TIER_LABEL]}<b>{n}</b></span>)}</div>
        </div>
      </div>
    </Card>
  );
}

// ---------------- 评分细则 ----------------
export function Rubric({ t, variant }: { t: SpecTask; variant: string | null }) {
  const wb = useWb();
  const [q, setQ] = useState('');
  const [dim, setDim] = useState('');
  const [tier, setTier] = useState('');
  const [method, setMethod] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const items = useMemo(() => t.items.filter((i) => (!variant || !i.variants.length || i.variants.includes(variant)) && (!dim || i.dim === dim) && (!tier || i.tier === tier) && (!method || i.method === method)
    && (!q || `${i.id} ${i.desc} ${i.metric} ${i.rule} ${i.evidence}`.toLowerCase().includes(q.toLowerCase()))), [t, variant, dim, tier, method, q]);
  const dims = [...new Set(t.items.map((i) => i.dim))];
  return (
    <div className="stack">
      <div className="rubric-f">
        <SearchInput value={q} onChange={setQ} placeholder="搜索检查项" size="sm" className="grow" />
        <Seg size="xs" value={method} onChange={setMethod} options={[{ value: '', label: '全部' }, { value: 'auto', label: '自动' }, { value: 'agent', label: 'Agent' }, { value: 'human', label: '人工' }]} />
        <Seg size="xs" value={tier} onChange={setTier} options={[{ value: '', label: '全部层级' }, { value: 'basic', label: '基础' }, { value: 'advanced', label: '进阶' }, { value: 'excellent', label: '卓越' }, { value: 'clean', label: '扣分' }]} />
      </div>
      <div className="chips">
        <button className={cls('chip', !dim && 'on')} onClick={() => setDim('')}>全部维度</button>
        {dims.map((d) => <button key={d} className={cls('chip', dim === d && 'on')} onClick={() => setDim(dim === d ? '' : d)}><i className="dot" style={{ background: `var(--d-${d})` }} />{wb.spec?.dims.find((x) => x.id === d)?.name || d}</button>)}
      </div>
      <div className="items">
        {items.map((i) => <ItemCard key={i.id} i={i} open={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} />)}
        {!items.length && <p className="muted small pad">没有匹配的检查项</p>}
      </div>
      {t.bugs && Object.keys(t.bugs).length > 0 && (
        <div>
          <div className="field-l mt">注入缺陷（评测方私有说明）</div>
          <table className="tbl compact mt-s"><thead><tr><th>编号</th><th>缺陷</th><th>根因</th><th>回归测试</th></tr></thead>
            <tbody>{Object.entries(t.bugs).map(([k, b]) => <tr key={k}><td className="mono">{b.issue || k}</td><td>{b.title}</td><td className="small">{b.root}</td><td className="mono small">{b.test}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

function ItemCard({ i, open, onToggle }: { i: SpecItem; open: boolean; onToggle: () => void }) {
  return (
    <div className={cls('item-c', open && 'open')}>
      <button className="item-h" onClick={onToggle} aria-expanded={open}>
        <span className="mono item-id">{i.id}</span>
        <span className={`tier-dot t-${i.tier}`} />
        <span className="grow item-d">{i.desc}</span>
        <span className={cls('badge', i.method === 'human' ? 'tone-accent' : i.method === 'agent' ? 'tone-info' : '')}>{i.method_label || METHOD_LABEL[i.method]}</span>
        <Tip text={`层级 ${i.tier_label || TIER_LABEL[i.tier]} · 权重 ${i.weight}`}><span className="mono muted xs">×{i.weight}</span></Tip>
      </button>
      {open && (
        <div className="item-b">
          <div className="row gap-s wrap"><DimChip id={i.dim} /><span className="chip">{i.tier_label || TIER_LABEL[i.tier]}</span>{i.variants.length > 0 && <span className="chip">仅 {i.variants.join('/')} 组</span>}</div>
          {i.metric && <div><span className="field-l">指标</span><p className="small">{i.metric}</p></div>}
          {i.rule && <div><span className="field-l">换算</span><p className="mono small">{i.rule}</p></div>}
          {i.evidence && <div><span className="field-l">依据</span><p className="small">{i.evidence}</p></div>}
          {i.anchors.length > 0 && <ol className="anchors" start={0}>{i.anchors.map((a, k) => <li key={k}><b>{k}</b><span>{a}</span></li>)}</ol>}
        </div>
      )}
    </div>
  );
}
