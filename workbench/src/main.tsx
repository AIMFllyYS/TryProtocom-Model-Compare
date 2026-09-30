import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RefreshCw, ServerCrash } from 'lucide-react';
import { App } from './app';
import { WbProvider } from './state';
import { Toaster } from './ui/toast';
import { ConfirmHost, Spinner } from './ui/kit';
import './styles.css';

function Boot({ err, retry }: { err: string | null; retry: () => void }) {
  if (!err) return <div className="boot"><Spinner size={22} /><span>正在连接工作台服务…</span></div>;
  return (
    <div className="boot">
      <ServerCrash size={34} aria-hidden />
      <h2>连不上工作台服务</h2>
      <p className="muted">{err}</p>
      <p className="muted small">双击仓库根目录的 <code>Start-Workbench.cmd</code>，或在终端运行 <code>wb start</code>，然后重试。</p>
      <button className="btn primary" onClick={retry}><RefreshCw size={14} /> <span>重试</span></button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WbProvider fallback={(err, retry) => <Boot err={err} retry={retry} />}>
      <App />
      <ConfirmHost />
    </WbProvider>
    <Toaster />
  </StrictMode>,
);
