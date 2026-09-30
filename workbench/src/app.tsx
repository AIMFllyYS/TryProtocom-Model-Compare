// 应用外壳：悬浮玻璃侧栏（分组导航 + 滑动指示）+ 顶部工具栏（面包屑、当前测评模型、搜索、任务托盘、盲评、主题）+ 视图区。
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, CloudDownload, Command, EyeOff, Eye, Loader2, Moon, PanelLeftClose, PanelLeftOpen, Sun, Check, X, Clock3 } from 'lucide-react';
import { NAV_GROUPS, SETTINGS_NAV, navOf } from './nav';
import { useWb } from './state';
import { go, href, useLocal, useRoute, type Route } from './lib/router';
import { cls, fmt } from './lib/format';
import { Palette } from './ui/palette';
import { IconBtn, Popover, Spinner, Tip } from './ui/kit';
import { ModelPicker } from './components/pickers';
import { GithubIcon } from './ui/brand';
import { desktop } from './api';
import Overview from './views/Overview';

const Models = lazy(() => import('./views/Models'));
const Tasks = lazy(() => import('./views/Tasks'));
const Runs = lazy(() => import('./views/Runs'));
const Stage = lazy(() => import('./views/Stage'));
const Board = lazy(() => import('./views/Board'));
const Compare = lazy(() => import('./views/Compare'));
const Exports = lazy(() => import('./views/Exports'));
const Docs = lazy(() => import('./views/Docs'));
const Settings = lazy(() => import('./views/Settings'));

export function App() {
  const wb = useWb();
  const route = useRoute();
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useLocal('nav.collapsed', false);
  const [theme, setTheme] = useLocal<'dark' | 'light'>('theme', (document.documentElement.dataset.theme as 'dark' | 'light') || 'light');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  useEffect(() => {
    let g = 0;
    const all = [...NAV_GROUPS.flatMap((x) => x.items), SETTINGS_NAV];
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'g') { g = Date.now(); return; }
      if (Date.now() - g < 900) { const n = all.find((x) => x.key === e.key.toLowerCase()); if (n) { e.preventDefault(); go(n.id); } g = 0; }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const cur = navOf(route.view);
  document.title = `${cur.label} · Bench Workbench`;
  const full = route.view === 'stage';

  return (
    <div className={cls('app', collapsed && 'side-collapsed')}>
      <Sidebar route={route} collapsed={collapsed} setCollapsed={setCollapsed} theme={theme} setTheme={setTheme} />
      <div className="main">
        <header className="toolbar glass-thin">
          <Crumbs route={route} />
          <div className="grow" />
          <div className="tb-model"><span className="tb-model-l">测评中</span><ModelPicker value={wb.current} onChange={wb.setCurrent} size="sm" /></div>
          <button className="search-btn" onClick={() => setPalette(true)}><Command size={14} aria-hidden /><span>搜索或执行命令</span><kbd>Ctrl K</kbd></button>
          <JobsTray />
          <IconBtn label={wb.blind ? '盲评模式：已隐藏模型名（点击显示）' : '盲评模式：点击隐藏模型名'} active={wb.blind} onClick={() => wb.setBlind(!wb.blind)} tipPlace="bottom">{wb.blind ? <EyeOff size={16} /> : <Eye size={16} />}</IconBtn>
        </header>
        <main className={cls('content', full && 'full')} id="view">
          <Suspense fallback={<div className="center pad-l"><Spinner size={22} /></div>}>
            <ViewSwitch route={route} />
          </Suspense>
        </main>
      </div>
      <Palette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

function Sidebar({ route, collapsed, setCollapsed, theme, setTheme }: { route: Route; collapsed: boolean; setCollapsed: (b: boolean) => void; theme: string; setTheme: (t: 'dark' | 'light') => void }) {
  const wb = useWb();
  const box = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ y: number; on: boolean }>({ y: 0, on: false });
  useLayoutEffect(() => {
    const place = () => {
      const el = box.current?.querySelector<HTMLElement>('.side-i.on');
      setThumb(el ? { y: el.offsetTop, on: true } : (t) => ({ ...t, on: false }));
    };
    place();
    const ro = new ResizeObserver(place);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [route.view, collapsed]);
  const pend = (wb.agg?.pending.human || 0) + (wb.agg?.pending.agent || 0);
  const live = (wb.store?.workspaces || []).filter((w) => !w.grader_run_id && (w.started_at || w.detect?.dir_exists)).length;
  const badge = (id: string) => id === 'runs' ? (live ? { n: live, c: 'live' } : pend ? { n: pend, c: '' } : null) : id === 'stage' && wb.previews.length ? { n: wb.previews.length, c: '' } : id === 'models' && wb.store ? null : null;
  const gh = wb.session.github;
  return (
    <nav className="side glass-thin" aria-label="主导航">
      <a className="side-brand" href={href('overview')} style={{ textDecoration: 'none', color: 'inherit' }}>
        <span className="logo"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l5-6 4 4 7-9" /><circle cx="20" cy="6" r="1.2" fill="#fff" /></svg></span>
        <span className="side-brand-t"><b>Model Compare</b><span>{wb.spec ? `${wb.spec.cfg.name} ${wb.spec.cfg.version}` : 'Bench Workbench'}</span></span>
      </a>
      <div className="side-scroll" ref={box}>
        <span className="side-thumb lens" style={{ transform: `translateY(${thumb.y}px)`, opacity: thumb.on ? 1 : 0 }} aria-hidden />
        {NAV_GROUPS.map((g) => (
          <div key={g.id} className="side-group">
            <div className="side-gl"><span>{g.label}</span></div>
            {g.items.map((n) => {
              const b = badge(n.id);
              const a = (
                <a key={n.id} href={href(n.id)} className={cls('side-i', route.view === n.id && 'on')} aria-current={route.view === n.id ? 'page' : undefined}>
                  <n.icon size={17} strokeWidth={2} aria-hidden />
                  <span className="side-l">{n.label}</span>
                  {b && <span className={cls('side-b', b.c)}>{b.n}</span>}
                </a>
              );
              return collapsed ? <Tip key={n.id} text={`${n.label} · ${n.desc}`} place="right-start">{a}</Tip> : a;
            })}
          </div>
        ))}
        <div className="side-group">
          <div className="side-gl"><span>系统</span></div>
          {(() => { const a = <a href={href('settings')} className={cls('side-i', route.view === 'settings' && 'on')}><SETTINGS_NAV.icon size={17} aria-hidden /><span className="side-l">设置</span>{wb.jobs.some((j) => j.status === 'running') && <span className="side-b live"><Loader2 size={11} className="spin" /></span>}</a>; return collapsed ? <Tip text="设置" place="right-start">{a}</Tip> : a; })()}
        </div>
      </div>
      <div className="side-foot">
        <IconBtn label="GitHub 开源仓库" onClick={() => { const D = desktop(); if (D) void D.openExternal(gh); else window.open(gh, '_blank', 'noopener'); }}><GithubIcon size={16} /></IconBtn>
        <IconBtn label="下载源码（ZIP，不含隐藏测试）" onClick={() => { location.href = '/api/source.zip'; }}><CloudDownload size={16} /></IconBtn>
        <IconBtn label={theme === 'dark' ? '切换到浅色' : '切换到深色'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</IconBtn>
        <span className="grow hide-c" />
        <Tip text={wb.conn === 'open' ? `服务已连接 · v${wb.session.version}` : wb.conn === 'down' ? '与服务断开，正在重连…' : '连接中…'}><span className={cls('conn-dot', wb.conn)} /></Tip>
        <IconBtn label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</IconBtn>
      </div>
    </nav>
  );
}

function Crumbs({ route }: { route: Route }) {
  const wb = useWb();
  const n = navOf(route.view);
  const parts: { label: string; href?: string }[] = [];
  const p = route.parts;
  if (route.view === 'tasks' && p[0]) { const t = wb.spec?.tasks.find((x) => x.id === p[0]); parts.push({ label: t ? `${t.id} ${t.name}` : p[0] }); }
  if (route.view === 'models' && p[1]) parts.push({ label: wb.blind ? '模型' : p[1] });
  if (route.view === 'runs' && p[0]) parts.push({ label: p.length >= 4 ? (wb.blind ? p.slice(2) : p.slice(1)).join(' / ') : p.join('/') });
  if (route.view === 'docs' && p[0]) parts.push({ label: p[0] });
  return (
    <div className="crumbs">
      <n.icon size={16} aria-hidden style={{ color: 'var(--text-2)' }} />
      {parts.length ? <a href={href(route.view)}>{n.label}</a> : <b>{n.label}</b>}
      {parts.map((x, i) => <span key={i} className="row gap-s" style={{ gap: 6 }}><ChevronRight size={14} />{i === parts.length - 1 ? <b>{x.label}</b> : <a href={x.href}>{x.label}</a>}</span>)}
    </div>
  );
}

function JobsTray() {
  const wb = useWb();
  const active = wb.jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const recent = [...wb.jobs].sort((a, b) => b.started_at - a.started_at).slice(0, 8);
  return (
    <Popover width={380} trigger={(p) => (
      <IconBtn {...p} label={active.length ? `${active.length} 个后台任务运行中` : '后台任务'} tipPlace="bottom" active={active.length > 0}>
        {active.length ? <Loader2 size={16} className="spin" /> : <Clock3 size={16} />}
      </IconBtn>
    )}>
      {(close) => (
        <div className="tray">
          <div className="tray-h"><b>后台任务</b><span className="muted xs">评分、导出等串行执行</span><a className="right small" href={href('settings', ['jobs'])} onClick={close}>全部</a></div>
          {!recent.length && <div className="pop-empty">还没有任务</div>}
          {recent.map((j) => (
            <a key={j.id} className="tray-i" href={href('settings', ['jobs'], { job: j.id })} onClick={close}>
              <span className={cls('tray-s', j.status)}>{j.status === 'running' ? <Loader2 size={13} className="spin" /> : j.status === 'done' ? <Check size={13} /> : j.status === 'failed' ? <X size={13} /> : <Clock3 size={13} />}</span>
              <span className="grow ellipsis">{j.title}</span>
              <span className="muted xs nowrap">{fmt.ago(j.started_at)}</span>
            </a>
          ))}
        </div>
      )}
    </Popover>
  );
}

function ViewSwitch({ route }: { route: Route }) {
  switch (route.view) {
    case 'overview': return <Overview />;
    case 'models': return <Models />;
    case 'tasks': return <Tasks />;
    case 'runs': return <Runs />;
    case 'stage': return <Stage />;
    case 'board': return <Board />;
    case 'compare': return <Compare />;
    case 'exports': return <Exports />;
    case 'docs': return <Docs />;
    case 'settings': return <Settings />;
  }
}
