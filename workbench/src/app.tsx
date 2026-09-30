// 应用外壳：侧栏导航 + 顶栏（命令面板、盲评、任务指示、连接状态、主题）+ 视图区。
import { lazy, Suspense, useEffect, useState } from 'react';
import { Command, EyeOff, Eye, Loader2, Moon, PanelLeftClose, PanelLeftOpen, Sun, Wifi, WifiOff } from 'lucide-react';
import { NAV } from './nav';
import { useWb } from './state';
import { go, href, useLocal, useRoute, type View } from './lib/router';
import { cls } from './lib/format';
import { Palette } from './ui/palette';
import { IconBtn, Spinner } from './ui/kit';
import { Overview } from './views/Overview';

const Board = lazy(() => import('./views/Board'));
const Models = lazy(() => import('./views/Models'));
const Runs = lazy(() => import('./views/Runs'));
const Review = lazy(() => import('./views/Review'));
const Stage = lazy(() => import('./views/Stage'));
const Spec = lazy(() => import('./views/Spec'));
const Jobs = lazy(() => import('./views/Jobs'));
const System = lazy(() => import('./views/System'));

export function App() {
  const wb = useWb();
  const route = useRoute();
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useLocal('nav.collapsed', false);
  const [theme, setTheme] = useLocal<'dark' | 'light'>('theme', (document.documentElement.dataset.theme as 'dark' | 'light') || 'dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  // 全局快捷键：Ctrl/⌘+K 命令面板；G + 字母 跳转视图
  useEffect(() => {
    let g = 0;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'g') { g = Date.now(); return; }
      if (Date.now() - g < 900) {
        const n = NAV.find((x) => x.key === e.key.toLowerCase());
        if (n) { e.preventDefault(); go(n.id); }
        g = 0;
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const running = wb.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  const cur = NAV.find((n) => n.id === route.view)!;
  const pendingReview = (wb.agg?.pending.human || 0) + (wb.agg?.pending.agent || 0);
  const stageFull = route.view === 'stage';
  document.title = `${cur.label} · Bench Workbench`;

  return (
    <div className={cls('app', collapsed && 'nav-collapsed')}>
      <nav className="nav" aria-label="主导航">
        <div className="nav-brand">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden><rect width="32" height="32" rx="8" className="logo-bg" /><path d="M7 22 L13 12 L18 18 L25 8" className="logo-line" /></svg>
          {!collapsed && <div className="nav-brand-t"><b>Bench Workbench</b><span>{wb.spec ? `${wb.spec.cfg.name} ${wb.spec.cfg.version}` : '模型评测工作台'}</span></div>}
        </div>
        <div className="nav-list">
          {NAV.map((n) => {
            const badge = n.id === 'review' ? pendingReview : n.id === 'jobs' ? running : n.id === 'stage' ? wb.previews.length : 0;
            return (
              <a key={n.id} href={href(n.id)} className={cls('nav-i', route.view === n.id && 'on')} title={collapsed ? `${n.label} — ${n.desc}` : n.desc} aria-current={route.view === n.id ? 'page' : undefined}>
                <n.icon size={18} aria-hidden />
                {!collapsed && <span className="nav-l">{n.label}</span>}
                {badge > 0 && <span className={cls('nav-b', n.id === 'jobs' && 'live')}>{badge}</span>}
              </a>
            );
          })}
        </div>
        <div className="nav-foot">
          <IconBtn label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</IconBtn>
          {!collapsed && <span className="nav-ver">v{wb.session.version}{wb.session.desktop ? ' · 桌面版' : ''}</span>}
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <div className="topbar-t">
            <cur.icon size={17} aria-hidden />
            <h1>{cur.label}</h1>
            <span className="topbar-d">{cur.desc}</span>
          </div>
          <button className="search-btn" onClick={() => setPalette(true)}>
            <Command size={14} aria-hidden /><span>搜索或执行命令</span><kbd>Ctrl K</kbd>
          </button>
          <div className="topbar-x">
            {running > 0 && (
              <a className="job-pill" href={href('jobs')} title="后台任务">
                <Loader2 size={13} className="spin" aria-hidden />{running} 个任务运行中
              </a>
            )}
            <IconBtn label={wb.blind ? '盲评模式：已隐藏模型名（点击显示）' : '盲评模式：关闭（点击隐藏模型名）'} active={wb.blind} onClick={() => wb.setBlind(!wb.blind)}>
              {wb.blind ? <EyeOff size={16} /> : <Eye size={16} />}
            </IconBtn>
            <IconBtn label={theme === 'dark' ? '切换到浅色' : '切换到深色'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</IconBtn>
            <span className={cls('conn', `conn-${wb.conn}`)} title={wb.conn === 'open' ? '实时连接正常' : wb.conn === 'down' ? '与服务断开，正在重连…' : '连接中…'}>
              {wb.conn === 'down' ? <WifiOff size={15} /> : <Wifi size={15} />}
            </span>
          </div>
        </header>
        <main className={cls('view', stageFull && 'view-full')} id="view">
          <Suspense fallback={<div className="center pad-l"><Spinner size={22} /></div>}>
            <ViewSwitch view={route.view} />
          </Suspense>
        </main>
      </div>
      <Palette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

function ViewSwitch({ view }: { view: View }) {
  switch (view) {
    case 'overview': return <Overview />;
    case 'board': return <Board />;
    case 'models': return <Models />;
    case 'runs': return <Runs />;
    case 'review': return <Review />;
    case 'stage': return <Stage />;
    case 'spec': return <Spec />;
    case 'jobs': return <Jobs />;
    case 'system': return <System />;
  }
}
