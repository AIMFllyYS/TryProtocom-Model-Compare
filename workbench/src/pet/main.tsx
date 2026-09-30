// Bench 小精灵：桌面宠物（Electron 透明置顶小窗加载本页）。只连接 127.0.0.1 上的工作台服务。
// 能力边界：读状态、在点击时执行工作台里已有的动作（登记评分、打开页面、复制 AI 评审提示词、截屏存证、取消任务）。
// 不监听键盘鼠标、不读取其他程序、截屏只在点击时进行且只保存在本机。
// 登记 / 自动评分开始时服务端会自动召唤宠物（设置里可关），展开“后台任务”即可看进度和完整评分日志；
// 进度、文案、进度条、日志终端与工作台主界面共用 components/jobview.tsx 和 styles/activity.css。
// 模块：bridge（与主进程通信、窗口尺寸）· Orb（宠物球与拖动）· fx（动效）· Resize（面板拖边改尺寸）。
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Bot, Camera, Check, ChevronDown, CircleAlert, ClipboardCopy, ExternalLink, FileCheck2, Gauge, Hourglass, Loader2, PenLine, Power, Sparkles, SquareTerminal, X } from 'lucide-react';
import { activityOfJob, isBusy } from '../../shared/activity';
import type { JobInfo } from '../../shared/types';
import { iconFor, MONO_ICONS } from '../../shared/vendors';
import { boot, connectEvents, get, post } from '../api';
import { bus, jobKey } from '../lib/bus';
import { cls } from '../lib/format';
import { ActBar, ActSteps, describe, forgetJobSeeds, isBad, JobTerm, jobMeta, useJobLines, useJobProgress, useTick } from '../components/jobview';
import { bridge, loadSize, open, saveSize, SIZE, type Sized } from './bridge';
import { Overlays, useFx, type Fx } from './fx';
import { Orb, type Mood } from './Orb';
import { ResizeEdges } from './Resize';
import '../styles/activity.css';
import './pet.css';

interface Brief { ref: string; tkey: string; index: number; name: string; vendor: string; model: string; harness: string; started_at: string | null; ended_at: string | null; detect: { done: number; total: number; final: boolean } | null }
interface PetTask { job: JobInfo; label: string | null; ref: string | null; run_id: string | null; score: { total: number; gate_pass: boolean; human: number } | null }
interface Feed {
  at: number; current: { key: string; vendor: string; model: string; harness: string; tasks: number; runs_per_task: number; delivered: number; graded: number } | null;
  running: Brief[]; delivered: Brief[]; grading: number; pending: { human: number; agent: number; usage_missing: number }; jobs: string[];
  tasks?: PetTask[];
  top: { entrant: string; quality: number | null; rank: string }[];
}

const ago = (iso: string | null) => { if (!iso) return '—'; const m = (Date.now() - Date.parse(iso)) / 60000; return m < 1 ? '刚刚' : m < 60 ? `${Math.round(m)} 分钟` : `${(m / 60).toFixed(1)} 小时`; };
const q = encodeURIComponent;
/** 去工作台打分：有工作区就按工作区打开预览，并展开评分面板 */
const scoreHash = (t: PetTask) => (t.run_id ? `stage?open=${q(t.ref ? 'ws:' + t.ref : 'run:' + t.run_id)}&score=${q(t.run_id)}` : 'runs');
const openScore = (t: PetTask) => open(scoreHash(t));
const openJob = (id: string) => open(`settings/jobs?job=${q(id)}`);
const ACTIVE = (j: JobInfo) => j.status === 'running' || j.status === 'queued';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Mode = 'orb' | 'bubble' | 'panel';
interface Bubble { text: string; tone?: 'ok' | 'busy' | 'bad'; actions?: { label: string; primary?: boolean; run: () => void }[]; ttl?: number }

function Pet() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [down, setDown] = useState(false);
  const [mode, setMode] = useState<Mode>(() => (location.hash === '#jobs' ? 'panel' : 'orb'));
  const [logId, setLogId] = useState<string | null>(null);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [busy, setBusy] = useState('');
  const [sizes, setSizes] = useState<Record<Sized, [number, number]>>(() => ({ panel: loadSize('panel'), log: loadSize('log') }));
  const fx = useFx();
  const orbRef = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const jobSeen = useRef<Map<string, JobInfo['status']> | null>(null);
  const hideT = useRef<number | undefined>(undefined);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const fxRef = useRef(fx);
  fxRef.current = fx;

  const pop = useCallback((b: Bubble) => {
    const f = fxRef.current;
    if (b.tone === 'bad') { f.kick('shake'); f.burst('sweat'); } else f.kick('peek');
    // 面板开着时：“开始登记 / 评分”已经显示在面板里，不再提示；其余结果在面板顶部短暂显示
    const inPanel = modeRef.current === 'panel';
    if (inPanel && b.tone === 'busy') return;
    setBubble(b);
    setMode((m) => (m === 'panel' ? m : 'bubble'));
    clearTimeout(hideT.current);
    hideT.current = window.setTimeout(() => { setBubble(null); setMode((m) => (m === 'bubble' ? 'orb' : m)); }, inPanel ? 4500 : b.ttl ?? 14000);
  }, []);

  const register = useCallback((ref: string) => {
    fxRef.current.kick('nod'); fxRef.current.burst('spark', 8);
    return post('/api/ws/finish', { ref, register: true, grade: true }).catch((e) => pop({ text: '出错了：' + e.message, tone: 'bad' }));
  }, [pop]);
  const showLog = useCallback((id: string) => { setLogId(id); setMode('panel'); }, []);

  const load = useCallback(async () => {
    try {
      const f = await get<Feed>('/api/pet/feed');
      setDown(false);
      setFeed(f);
      // 新交付：气泡提醒 + 一键登记评分
      const refs = f.delivered.map((d) => d.ref);
      if (seen.current) {
        const fresh = f.delivered.find((d) => !seen.current!.has(d.ref));
        if (fresh) { fxRef.current.burst('spark', 10); pop({ text: `${fresh.model} 交付了 ${fresh.tkey} · r${fresh.index}`, tone: 'ok', actions: [{ label: '登记并评分', primary: true, run: () => void register(fresh.ref) }, { label: '查看', run: () => open('runs/' + fresh.ref) }] }); }
      }
      seen.current = new Set(refs);
      // 后台任务状态变化：开始 / 完成 / 失败（动效总会播；面板开着时不再弹气泡）
      const tasks = f.tasks || [];
      const prev = jobSeen.current;
      if (prev) {
        for (const t of tasks) {
          const was = prev.get(t.job.id);
          if (was === t.job.status) continue;
          const who = t.label ? ` · ${t.label}` : '';
          const evalJob = t.job.kind === 'register' || t.job.kind === 'grade';
          if (ACTIVE(t.job) && !was && evalJob) pop({ text: `${t.job.kind === 'register' ? '开始登记' : '开始自动评分'}${who}`, tone: 'busy', ttl: 8000, actions: [{ label: '看进度和日志', primary: true, run: () => showLog(t.job.id) }] });
          else if (t.job.status === 'done' && was && t.job.kind === 'grade') {
            const s = t.score;
            fxRef.current.burst('confetti', 16);
            pop({ text: `自动评分完成${who}${s ? ` · ${s.gate_pass ? `${Number(s.total).toFixed(1)} 分` : '门槛未过（0 分）'}${s.human ? ` · 还有 ${s.human} 个人工项` : ''}` : ''}`, tone: 'ok', ttl: 20000,
              actions: [...(s?.human ? [{ label: '去打分', primary: true, run: () => openScore(t) }] : []), { label: '看日志', run: () => showLog(t.job.id) }] });
            fxRef.current.kick('party');
          } else if (t.job.status === 'failed' && was) pop({ text: `${t.job.kind === 'grade' ? '自动评分失败' : t.job.kind === 'register' ? '登记失败' : '任务失败'}${who}${t.job.error ? ' · ' + t.job.error : ''}`, tone: 'bad', ttl: 30000, actions: [{ label: '看日志', primary: true, run: () => showLog(t.job.id) }] });
        }
      }
      jobSeen.current = new Map(tasks.map((t) => [t.job.id, t.job.status]));
    } catch { setDown(true); }
  }, [pop, register, showLog]);

  // 连接：取 token → 首次拉取 → SSE（自动重连）：store / job 事件再拉精简状态，job-line 进日志；另有 60 秒兜底轮询
  useEffect(() => {
    let t: number | undefined;
    let stop: (() => void) | null = null;
    let dead = false;
    void boot().then(async () => {
      if (dead) return;
      await load();
      stop = connectEvents((e) => {
        if (e.type === 'job-line') bus.append(jobKey(e.id), [e.line], 6000);
        else if (e.type === 'store' || e.type === 'job') { clearTimeout(t); t = window.setTimeout(() => void load(), e.type === 'job' ? 150 : 400); }
      }, (c) => { if (c === 'down') setDown(true); else if (c === 'open') { forgetJobSeeds(); setDown(false); void load(); } });
    }, () => setDown(true));
    const poll = window.setInterval(() => void load(), 60000);
    return () => { dead = true; stop?.(); clearInterval(poll); clearTimeout(t); };
  }, [load]);

  // 窗口尺寸跟随模式；面板 / 日志页用你拖出来的尺寸
  const sized: Sized = logId ? 'log' : 'panel';
  const [ww, wh] = mode === 'panel' ? sizes[sized] : SIZE[mode];
  useEffect(() => { bridge?.setSize(ww, wh); }, [ww, wh]);
  const onResized = (s: [number, number] | null) => { saveSize(sized, s); setSizes((p) => ({ ...p, [sized]: s || [SIZE[sized][0], SIZE[sized][1]] })); };

  const act = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); try { await fn(); await load(); } catch (e: any) { pop({ text: '出错了：' + e.message, tone: 'bad' }); } finally { setBusy(''); } };
  // 截屏：先“茄子”，截完闪光，缩略图飞进宠物嘴里，再保存
  const shot = () => act('shot', async () => {
    if (!bridge) throw new Error('截屏需要在桌面宠物中使用');
    fx.kick('cheese');
    await wait(380);
    const data = await bridge.capture();
    if (!data) throw new Error('截屏失败');
    fx.camera();
    const from = document.querySelector('.pet-panel')?.getBoundingClientRect(), to = orbRef.current?.querySelector('.orb-body')?.getBoundingClientRect();
    const save = post<{ path: string }>('/api/shots', { data, ref: feed?.running[0]?.ref || feed?.delivered[0]?.ref, label: 'screen' });
    if (from && to) await fx.swallow(data, from, to);
    fx.kick('gulp'); fx.burst('spark', 8);
    const r = await save;
    pop({ text: `已截屏保存：${r.path.split('/').slice(-2).join('/')}`, tone: 'ok' });
  });
  const aiPrompt = () => act('ai', async () => { const r = await get<{ text: string }>('/api/review-prompt'); await navigator.clipboard.writeText(r.text); fx.kick('wink'); fx.burst('heart', 6); pop({ text: '已复制 AI 评审提示词', tone: 'ok' }); });
  // 打开工作台：跳起转一圈、往上撒星星，再打开
  const launch = (hash: string) => { fx.kick('launch'); fx.burst('star', 10); window.setTimeout(() => open(hash), 260); };
  const quit = () => { fx.kick('bye'); window.setTimeout(() => bridge?.quit(), 430); };

  const tasks = useMemo(() => feed?.tasks || [], [feed]);
  const allJobs = useMemo(() => tasks.map((t) => t.job), [tasks]);
  const working = tasks.filter((t) => ACTIVE(t.job));
  const lead = working.find((t) => t.job.status === 'running') || working[0] || null;
  const mood: Mood = down ? 'sleep' : feed?.delivered.length ? 'alert' : feed?.running.length || working.length ? 'busy' : feed?.current && feed.current.graded >= feed.current.tasks * feed.current.runs_per_task ? 'happy' : 'idle';
  const cur = feed?.current;
  const total = cur ? cur.tasks * cur.runs_per_task : 0;
  const logTask = logId ? tasks.find((t) => t.job.id === logId) || null : null;
  const edges = <ResizeEdges k={sized} onDone={onResized} />;

  return (
    <div className={`pet-root mode-${mode}`}>
      {mode === 'panel' && feed && logId && (
        <JobPanel t={logTask} id={logId} jobs={allJobs} fx={fx} edges={edges} onScore={(t) => launch(scoreHash(t))} onBack={() => setLogId(null)} onClose={() => { setLogId(null); setMode('orb'); }} onError={(m) => pop({ text: m, tone: 'bad' })} />
      )}
      {mode === 'panel' && feed && !logId && (
        <section className="pet-panel">
          {edges}
          <header className="pp-h">
            {cur ? <Logo vendor={cur.vendor} model={cur.model} /> : <span className="pp-logo"><Sparkles size={16} /></span>}
            <div className="grow"><b>{cur ? cur.model : '未选择测评模型'}</b><span>{cur ? `已交付 ${cur.delivered}/${total} · 已评分 ${cur.graded}` : '在工作台右上角选择'}</span></div>
            <button className="pp-x" onClick={() => setMode('orb')} aria-label="收起"><ChevronDown size={16} /></button>
          </header>
          {cur && <div className="pp-bar"><i style={{ width: `${total ? (cur.delivered / total) * 100 : 0}%` }} /><i className="g" style={{ width: `${total ? (cur.graded / total) * 100 : 0}%` }} /></div>}
          <div className="pp-scroll">
            {tasks.length > 0 && (
              <div className={cls('pp-g', working.length > 0 && 'live')}>
                <div className="pp-gh"><Gauge size={14} /><b>后台任务</b>{working.length > 0 && <span className="pp-n">{working.length}</span>}</div>
                {tasks.map((t) => <JobRow key={t.job.id} t={t} jobs={allJobs} onOpen={() => setLogId(t.job.id)} />)}
              </div>
            )}
            <Group icon={<FileCheck2 size={14} />} title="已交付 · 待登记" n={feed.delivered.length}>
              {feed.delivered.map((d) => (
                <div key={d.ref} className="pp-i">
                  <div className="grow"><b>{d.tkey} · r{d.index}</b><span>{d.model} · {d.detect ? `交付 ${d.detect.done}/${d.detect.total}` : ''}</span></div>
                  <button className="pp-btn primary" disabled={!!busy} onClick={() => void act('reg:' + d.ref, () => register(d.ref))}>{busy === 'reg:' + d.ref ? <Loader2 size={13} className="spin" /> : '登记评分'}</button>
                </div>
              ))}
            </Group>
            <Group icon={<Hourglass size={14} />} title="进行中" n={feed.running.length}>
              {feed.running.map((d) => (
                <div key={d.ref} className="pp-i" onClick={() => launch('runs/' + d.ref)}>
                  <div className="grow"><b>{d.tkey} · r{d.index}</b><span>{d.model} · 已开跑 {ago(d.started_at)}</span></div>
                  <span className="pp-prog">{d.detect ? `${d.detect.done}/${d.detect.total}` : ''}</span>
                </div>
              ))}
            </Group>
            <div className="pp-g">
              <div className="pp-gh"><Bot size={14} /><b>待评</b></div>
              <div className="pp-stats">
                <button onClick={() => launch('runs')}><b>{feed.pending.human}</b><span>人工项</span></button>
                <button onClick={() => void aiPrompt()}><b>{feed.pending.agent}</b><span>Agent 项 · 复制提示词</span></button>
                <button onClick={() => launch('runs')}><b>{feed.grading}</b><span>待自动评分</span></button>
              </div>
            </div>
            {feed.top.length > 0 && (
              <div className="pp-g">
                <div className="pp-gh"><Sparkles size={14} /><b>榜单</b></div>
                {feed.top.map((t) => <div key={t.entrant} className="pp-top"><span className="mono">{t.rank}</span><span className="grow ellipsis">{t.entrant}</span><b>{t.quality?.toFixed(1) ?? '—'}</b></div>)}
              </div>
            )}
          </div>
          <footer className="pp-f">
            <button className="pp-btn" onClick={() => void shot()} disabled={!!busy} title="截取整个屏幕，保存到当前运行旁的 .shots/（只在本机）">{busy === 'shot' ? <Loader2 size={13} className="spin" /> : <Camera size={14} />}截屏存证</button>
            <button className="pp-btn" onClick={() => launch(cur ? 'overview' : 'models')}><ExternalLink size={14} />打开工作台</button>
            <span className="grow" />
            <button className="pp-btn ghost" onClick={quit} title={working.length ? '退出桌面宠物（本轮任务结束前不会再自动召唤）' : '退出桌面宠物'}><Power size={14} /></button>
          </footer>
        </section>
      )}
      {mode === 'bubble' && bubble && (
        <div className={cls('pet-bubble', bubble.tone)}>
          <button className="pb-x" onClick={() => { setBubble(null); setMode('orb'); }} aria-label="关闭"><X size={12} /></button>
          <div className="pb-t"><span className="pb-ic">{bubble.tone === 'busy' ? <Loader2 size={13} className="spin" /> : bubble.tone === 'bad' ? <CircleAlert size={13} strokeWidth={2.6} /> : <Check size={13} strokeWidth={3} />}</span>{bubble.text}</div>
          {!!bubble.actions?.length && <div className="pb-a">{bubble.actions.map((a) => <button key={a.label} className={cls('pp-btn', a.primary && 'primary')} onClick={() => { a.run(); setBubble(null); setMode((m) => (m === 'bubble' ? 'orb' : m)); }}>{a.label}</button>)}</div>}
        </div>
      )}
      {mode === 'panel' && bubble && (
        <div className={cls('pet-toast', bubble.tone)} role="status" onClick={() => setBubble(null)}>
          <span className="pb-ic">{bubble.tone === 'bad' ? <CircleAlert size={12} strokeWidth={2.6} /> : <Check size={12} strokeWidth={3} />}</span><span className="ellipsis">{bubble.text}</span>
        </div>
      )}
      <Orb orbRef={orbRef} mood={mood} badge={feed?.delivered.length || 0} lead={lead} jobs={allJobs} fx={fx} onTap={() => setMode((m) => (m === 'panel' ? 'orb' : 'panel'))} />
      <Overlays fx={fx} />
    </div>
  );
}

/** 面板里的一行任务：状态 + 对应运行 + 短进度 + 细进度条；点开看完整日志 */
function JobRow({ t, jobs, onOpen }: { t: PetTask; jobs: JobInfo[]; onOpen: () => void }) {
  const a = activityOfJob(t.job, jobs);
  const live = isBusy(a);
  const p = useJobProgress(t.job.id, live); // 宠物中途启动时先补齐已有输出，才读得到当前探针
  useTick(live);
  const d = describe(a, p);
  const bad = isBad(d);
  const s = t.score;
  return (
    <button className={cls('pp-i pp-job', live && 'live', bad && 'bad', d.phase === 'done' && 'done')} onClick={onOpen} title="查看完整日志">
      <span className="pp-ji">{d.phase === 'queued' ? <Hourglass size={14} /> : live ? <Loader2 size={14} className="spin" /> : bad ? <CircleAlert size={14} /> : <Check size={14} strokeWidth={2.6} />}</span>
      <div className="grow stack0">
        <b className="ellipsis">{d.title}{t.label ? <em> · {t.label}</em> : null}</b>
        <span className="ellipsis">{d.phase === 'done' && s ? `${s.gate_pass ? `${Number(s.total).toFixed(1)} 分` : '门槛未过'}${s.human ? ` · 还有 ${s.human} 个人工项` : ''} · ${d.short}` : d.phase === 'failed' ? d.sub : d.short || d.sub}</span>
        {live && <ActBar frac={d.frac} />}
      </div>
      <SquareTerminal size={14} className="pp-jl" />
    </button>
  );
}

/** 任务详情：分步进度 + 完整评分日志（实时追加）+ 取消 / 去打分 / 复制日志 / 在工作台打开 */
function JobPanel({ t, id, jobs, fx, edges, onScore, onBack, onClose, onError }: {
  t: PetTask | null; id: string; jobs: JobInfo[]; fx: Fx; edges: React.ReactNode; onScore: (t: PetTask) => void; onBack: () => void; onClose: () => void; onError: (m: string) => void;
}) {
  const lines = useJobLines(id, true);
  const [job, setJob] = useState<JobInfo | null>(t?.job || null);
  // 任务已滑出宠物的列表（超过 15 分钟）时仍能看：单独取一次任务信息
  useEffect(() => { if (t) setJob(t.job); else void get<JobInfo>(`/api/jobs/${id}`).then(setJob, () => setJob(null)); }, [t, id]);
  const a = job ? activityOfJob(job, jobs.length ? jobs : [job]) : null;
  const p = useJobProgress(id);
  useTick(!!a && isBusy(a));
  const d = a ? describe(a, p) : null;
  const bad = d ? isBad(d) : false;
  const cancel = () => { fx.kick('nod'); void post(`/api/jobs/${id}/cancel`).catch((e) => onError('取消失败：' + e.message)); };
  const copy = () => void navigator.clipboard.writeText(lines.join('\n')).then(() => { fx.kick('wink'); fx.burst('spark', 6); }, () => onError('复制失败'));
  return (
    <section className="pet-panel pet-log">
      {edges}
      <header className="pp-h">
        <button className="pp-x" onClick={onBack} aria-label="返回"><ArrowLeft size={16} /></button>
        <div className="grow"><b className="ellipsis">{d ? d.title : '任务'}{t?.label ? ` · ${t.label}` : ''}</b><span className="ellipsis">{job ? `${job.title} · ${jobMeta(job)}` : '任务已不在列表中'}</span></div>
        <button className="pp-x" onClick={onClose} aria-label="收起"><ChevronDown size={16} /></button>
      </header>
      {a && d && (
        <div className={cls('pl-state', bad && 'bad')}>
          <ActSteps a={a} p={p} d={d} />
          {!bad && d.phase !== 'done' && <ActBar frac={d.frac} lg />}
          <span className="pl-sub">{d.sub}{t?.score && d.phase === 'done' ? ` · ${t.score.gate_pass ? `${Number(t.score.total).toFixed(1)} 分` : '门槛未过（0 分）'}${t.score.human ? ` · 还有 ${t.score.human} 个人工项` : ''}` : ''}</span>
        </div>
      )}
      <JobTerm lines={lines} className="pl-term" empty={job && ACTIVE(job) ? '等待输出…' : '（暂无输出）'} />
      <footer className="pp-f">
        {a && isBusy(a) && <button className="pp-btn" onClick={cancel}><X size={14} />取消</button>}
        {t?.score?.human ? <button className="pp-btn primary" onClick={() => onScore(t)}><PenLine size={14} />去打分</button> : null}
        <button className="pp-btn" onClick={copy} disabled={!lines.length}><ClipboardCopy size={14} />复制日志</button>
        <span className="grow" />
        <button className="pp-btn ghost" onClick={() => { fx.kick('launch'); fx.burst('star', 8); window.setTimeout(() => openJob(id), 260); }} title="在工作台「设置 → 后台任务」里打开"><ExternalLink size={14} />工作台</button>
      </footer>
    </section>
  );
}

function Group({ icon, title, n, children }: { icon: React.ReactNode; title: string; n: number; children: React.ReactNode }) {
  if (!n) return null;
  return <div className="pp-g"><div className="pp-gh">{icon}<b>{title}</b><span className="pp-n">{n}</span></div>{children}</div>;
}
function Logo({ vendor, model }: { vendor: string; model: string }) {
  const ic = iconFor(vendor, model);
  return <span className="pp-logo">{ic ? (MONO_ICONS.has(ic) ? <i className="pp-mono" style={{ ['--ic' as string]: `url(/brands/${ic}.svg)` }} /> : <img src={`/brands/${ic}.svg`} alt="" />) : model.slice(0, 1)}</span>;
}

createRoot(document.getElementById('pet')!).render(<StrictMode><Pet /></StrictMode>);
