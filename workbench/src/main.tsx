import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RefreshCw, ServerCrash } from 'lucide-react';
import { App } from './app';
import { WbProvider } from './state';
import { Toaster } from './ui/toast';
import { ConfirmHost, ContextMenuHost, Spinner } from './ui/kit';
import './styles/tokens.css';
import './styles/glass.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/views.css';
import './styles/activity.css';
import './styles/stage.css';
import './styles/launch.css';

// Chromium 支持 backdrop-filter 引用 SVG 滤镜：开启透镜折射（其他内核只用模糊玻璃）
const ua = navigator.userAgent;
if (/Chrome\/\d+/.test(ua) && !/Firefox/.test(ua) && CSS.supports('backdrop-filter', 'blur(1px)')) document.documentElement.classList.add('can-refract');

// 跟随指针的镜面高光：给最近的 .sheen 写入指针相对坐标
let raf = 0;
window.addEventListener('pointermove', (e) => {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const el = (e.target as Element | null)?.closest?.('.sheen') as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
}, { passive: true });

/** 透镜位移图：中心不动，靠近边缘的像素向外偏移，形成玻璃边缘的折射弯曲 */
const LENS_MAP = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" preserveAspectRatio="none">
    <defs>
      <linearGradient id="x" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#000"/><stop offset=".18" stop-color="#800000"/><stop offset=".82" stop-color="#800000"/><stop offset="1" stop-color="#f00"/></linearGradient>
      <linearGradient id="y" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset=".22" stop-color="#008000"/><stop offset=".78" stop-color="#008000"/><stop offset="1" stop-color="#0f0"/></linearGradient>
    </defs>
    <rect width="100" height="100" fill="url(#x)"/><rect width="100" height="100" fill="url(#y)" style="mix-blend-mode:screen"/>
  </svg>`);

function Defs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <filter id="lg-lens" x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
        <feImage href={LENS_MAP} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale="0.06" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

function Aura() { return <div className="aura" aria-hidden><i /><i /><i /><i /><i /></div>; }

function Boot({ err, retry }: { err: string | null; retry: () => void }) {
  return (
    <div className="boot">
      <div className="boot-card glass-thick">
        {!err ? <><Spinner size={22} /><span className="dim">正在连接工作台服务…</span></> : (
          <>
            <ServerCrash size={34} aria-hidden />
            <h2>连不上工作台服务</h2>
            <p className="muted">{err}</p>
            <p className="muted small">双击仓库根目录的 <code>Start-Workbench.cmd</code>，或在终端运行 <code>wb start</code>，然后重试。</p>
            <button className="btn primary" onClick={retry}><RefreshCw size={14} /> <span>重试</span></button>
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Defs />
    <Aura />
    <WbProvider fallback={(err, retry) => <Boot err={err} retry={retry} />}>
      <App />
      <ConfirmHost />
      <ContextMenuHost />
    </WbProvider>
    <Toaster />
  </StrictMode>,
);
