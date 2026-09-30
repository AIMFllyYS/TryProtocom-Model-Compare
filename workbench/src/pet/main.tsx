// Bench 小精灵：桌面宠物（Electron 透明置顶小窗加载本页）。只连接 127.0.0.1 上的工作台服务。
// 能力边界：读状态、在点击时执行工作台里已有的动作（登记评分、打开页面、复制 AI 评审提示词、截屏存证）。
// 不监听键盘鼠标、不读取其他程序、截屏只在点击时进行且只保存在本机。
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot, Camera, Check, ChevronDown, ExternalLink, FileCheck2, Hourglass, Loader2, Power, Sparkles, X } from 'lucide-react';
import { iconFor, MONO_ICONS } from '../../shared/vendors';
import './pet.css';

interface Brief { ref: string; tkey: string; index: number; name: string; vendor: string; model: string; harness: string; started_at: string | null; ended_at: string | null; detect: { done: number; total: number; final: boolean } | null }
interface Feed {
  at: number; current: { key: string; vendor: string; model: string; harness: string; tasks: number; runs_per_task: number; delivered: number; graded: number } | null;
  running: Brief[]; delivered: Brief[]; grading: number; pending: { human: number; agent: number; usage_missing: number }; jobs: string[];
  top: { entrant: string; quality: number | null; rank: string }[];
}
interface PetBridge { setSize(w: number, h: number): void; moveBy(dx: number, dy: number): void; capture(): Promise<string | null>; open(hash: string): void; quit(): void }
declare global { interface Window { wbPet?: PetBridge } }
const bridge = window.wbPet;

let token = '';
async function api<T>(p: string, body?: unknown): Promise<T> {
  const r = await fetch(p, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-wb-token': token }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j as T;
}
const ago = (iso: string | null) => { if (!iso) return '—'; const m = (Date.now() - Date.parse(iso)) / 60000; return m < 1 ? '刚刚' : m < 60 ? `${Math.round(m)} 分钟` : `${(m / 60).toFixed(1)} 小时`; };
const open = (hash: string) => { if (bridge) bridge.open(hash); else window.open('/#/' + hash, '_blank'); };

type Mood = 'idle' | 'busy' | 'alert' | 'happy' | 'sleep';
const SIZE = { orb: [150, 150], bubble: [360, 250], panel: [380, 560] } as const;

function Pet() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [down, setDown] = useState(false);
  const [mode, setMode] = useState<'orb' | 'bubble' | 'panel'>('orb');
  const [bubble, setBubble] = useState<{ text: string; ref?: string } | null>(null);
  const [busy, setBusy] = useState('');
  const seen = useRef<Set<string> | null>(null);
  const hideT = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const f = await api<Feed>('/api/pet/feed');
      setDown(false);
      setFeed(f);
      const refs = f.delivered.map((d) => d.ref);
      if (seen.current) {
        const fresh = f.delivered.find((d) => !seen.current!.has(d.ref));
        if (fresh) {
          setBubble({ text: `${fresh.model} 交付了 ${fresh.tkey} · r${fresh.index}`, ref: fresh.ref });
          setMode((m) => (m === 'panel' ? m : 'bubble'));
          clearTimeout(hideT.current);
          hideT.current = window.setTimeout(() => { setBubble(null); setMode((m) => (m === 'bubble' ? 'orb' : m)); }, 14000);
        }
      }
      seen.current = new Set(refs);
    } catch { setDown(true); }
  }, []);

  // 连接：取 token → 首次拉取 → 订阅 SSE 的 store 事件再拉精简状态；另有 60 秒兜底轮询
  useEffect(() => {
    let es: EventSource | null = null;
    let t: number | undefined;
    const start = async () => {
      try { token = (await (await fetch('/api/session')).json()).token; } catch { setDown(true); }
      await load();
      es = new EventSource('/api/events');
      es.onmessage = (m) => { try { const e = JSON.parse(m.data); if (e.type === 'store' || e.type === 'job') { clearTimeout(t); t = window.setTimeout(() => void load(), 400); } } catch { /* */ } };
      es.onerror = () => setDown(true);
      es.onopen = () => { setDown(false); void load(); };
    };
    void start();
    const poll = window.setInterval(() => void load(), 60000);
    return () => { es?.close(); clearInterval(poll); };
  }, [load]);

  useEffect(() => { const [w, h] = SIZE[mode]; bridge?.setSize(w, h); }, [mode]);

  // 拖动宠物（在桌面上移动窗口）；轻点 = 打开 / 收起面板
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.screenX, y: e.screenY, moved: false }; (e.target as HTMLElement).setPointerCapture(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.screenX - d.x, dy = e.screenY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true; d.x = e.screenX; d.y = e.screenY;
    bridge?.moveBy(dx, dy);
  };
  const onUp = () => { const d = drag.current; drag.current = null; if (d && !d.moved) setMode((m) => (m === 'panel' ? 'orb' : 'panel')); };

  const act = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); try { await fn(); await load(); } catch (e: any) { setBubble({ text: '出错了：' + e.message }); } finally { setBusy(''); } };
  const register = (ref: string) => act('reg:' + ref, () => api('/api/ws/finish', { ref, register: true, grade: true }));
  const shot = () => act('shot', async () => {
    const data = bridge ? await bridge.capture() : null;
    if (!data) throw new Error('截屏需要在桌面宠物中使用');
    const ref = feed?.running[0]?.ref || feed?.delivered[0]?.ref;
    const r = await api<{ path: string }>('/api/shots', { data, ref, label: 'screen' });
    setBubble({ text: `已截屏保存：${r.path.split('/').slice(-2).join('/')}` });
  });
  const aiPrompt = () => act('ai', async () => { const r = await api<{ text: string }>('/api/review-prompt'); await navigator.clipboard.writeText(r.text); setBubble({ text: '已复制 AI 评审提示词' }); });

  const mood: Mood = down ? 'sleep' : feed?.delivered.length ? 'alert' : feed?.running.length || feed?.jobs.length ? 'busy' : feed?.current && feed.current.graded >= feed.current.tasks * feed.current.runs_per_task ? 'happy' : 'idle';
  const cur = feed?.current;
  const total = cur ? cur.tasks * cur.runs_per_task : 0;

  return (
    <div className={`pet-root mode-${mode}`}>
      {mode === 'panel' && feed && (
        <section className="pet-panel">
          <header className="pp-h">
            {cur ? <Logo vendor={cur.vendor} model={cur.model} /> : <span className="pp-logo"><Sparkles size={16} /></span>}
            <div className="grow"><b>{cur ? cur.model : '未选择测评模型'}</b><span>{cur ? `已交付 ${cur.delivered}/${total} · 已评分 ${cur.graded}` : '在工作台右上角选择'}</span></div>
            <button className="pp-x" onClick={() => setMode('orb')} aria-label="收起"><ChevronDown size={16} /></button>
          </header>
          {cur && <div className="pp-bar"><i style={{ width: `${total ? (cur.delivered / total) * 100 : 0}%` }} /><i className="g" style={{ width: `${total ? (cur.graded / total) * 100 : 0}%` }} /></div>}
          <div className="pp-scroll">
            <Group icon={<FileCheck2 size={14} />} title="已交付 · 待登记" n={feed.delivered.length}>
              {feed.delivered.map((d) => (
                <div key={d.ref} className="pp-i">
                  <div className="grow"><b>{d.tkey} · r{d.index}</b><span>{d.model} · {d.detect ? `交付 ${d.detect.done}/${d.detect.total}` : ''}</span></div>
                  <button className="pp-btn primary" disabled={!!busy} onClick={() => void register(d.ref)}>{busy === 'reg:' + d.ref ? <Loader2 size={13} className="spin" /> : '登记评分'}</button>
                </div>
              ))}
            </Group>
            <Group icon={<Hourglass size={14} />} title="进行中" n={feed.running.length}>
              {feed.running.map((d) => (
                <div key={d.ref} className="pp-i" onClick={() => open('runs/' + d.ref)}>
                  <div className="grow"><b>{d.tkey} · r{d.index}</b><span>{d.model} · 已开跑 {ago(d.started_at)}</span></div>
                  <span className="pp-prog">{d.detect ? `${d.detect.done}/${d.detect.total}` : ''}</span>
                </div>
              ))}
            </Group>
            <div className="pp-g">
              <div className="pp-gh"><Bot size={14} /><b>待评</b></div>
              <div className="pp-stats">
                <button onClick={() => open('runs')}><b>{feed.pending.human}</b><span>人工项</span></button>
                <button onClick={() => void aiPrompt()}><b>{feed.pending.agent}</b><span>Agent 项 · 复制提示词</span></button>
                <button onClick={() => open('runs')}><b>{feed.grading}</b><span>待自动评分</span></button>
              </div>
            </div>
            {feed.jobs.length > 0 && <div className="pp-job"><Loader2 size={13} className="spin" />{feed.jobs[0]}{feed.jobs.length > 1 ? ` 等 ${feed.jobs.length} 个任务` : ''}</div>}
            {feed.top.length > 0 && (
              <div className="pp-g">
                <div className="pp-gh"><Sparkles size={14} /><b>榜单</b></div>
                {feed.top.map((t) => <div key={t.entrant} className="pp-top"><span className="mono">{t.rank}</span><span className="grow ellipsis">{t.entrant}</span><b>{t.quality?.toFixed(1) ?? '—'}</b></div>)}
              </div>
            )}
          </div>
          <footer className="pp-f">
            <button className="pp-btn" onClick={() => void shot()} disabled={!!busy} title="截取整个屏幕，保存到当前运行旁的 .shots/（只在本机）">{busy === 'shot' ? <Loader2 size={13} className="spin" /> : <Camera size={14} />}截屏存证</button>
            <button className="pp-btn" onClick={() => open(cur ? 'overview' : 'models')}><ExternalLink size={14} />打开工作台</button>
            <span className="grow" />
            <button className="pp-btn ghost" onClick={() => bridge?.quit()} title="退出桌面宠物"><Power size={14} /></button>
          </footer>
        </section>
      )}
      {mode === 'bubble' && bubble && (
        <div className="pet-bubble">
          <button className="pb-x" onClick={() => { setBubble(null); setMode('orb'); }} aria-label="关闭"><X size={12} /></button>
          <div className="pb-t"><span className="pb-ic"><Check size={13} strokeWidth={3} /></span>{bubble.text}</div>
          {bubble.ref && <div className="pb-a"><button className="pp-btn primary" onClick={() => void register(bubble.ref!)}>登记并评分</button><button className="pp-btn" onClick={() => open('runs/' + bubble.ref)}>查看</button></div>}
        </div>
      )}
      <div className={`orb mood-${mood}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} role="button" aria-label="Bench 小精灵：点击展开，拖动移动">
        <div className="orb-glow" />
        <div className="orb-ring" />
        <div className="orb-body">
          <div className="orb-sheen" />
          <div className="orb-face">
            <i className="eye l" /><i className="eye r" />
            <i className="mouth" />
            <i className="cheek l" /><i className="cheek r" />
          </div>
        </div>
        {(feed?.delivered.length || 0) > 0 && <span className="orb-badge">{feed!.delivered.length}</span>}
        {mood === 'sleep' && <span className="orb-zz">z z</span>}
      </div>
    </div>
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
