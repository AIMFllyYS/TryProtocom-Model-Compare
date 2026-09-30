// 预览窗格：地址栏 + 设备/缩放/旋转 + 视口（网页版 iframe，桌面版 Chromium webview）+ 可停靠的 F12 面板。
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bug, Camera, ExternalLink, Maximize2, Minimize2, MonitorSmartphone, RotateCcw, RotateCw, ScanSearch, Smartphone, Terminal, X } from 'lucide-react';
import type { LogEntry, PreviewSession } from '../../shared/types';
import { desktop, post, rawUrl } from '../api';
import { bus, logKey, navKey, perfKey, useBus } from '../state';
import { cls } from '../lib/format';
import { Badge, Btn, IconBtn, Modal, Select, Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { VideoPlayer } from '../components/VideoPlayer';
import { DevTools } from './DevTools';
import { DEVICES, deviceById, ZOOMS } from './devices';

export type PaneSrc = { type: 'session'; sid: string } | { type: 'video'; path: string; label: string };
export interface PaneState { id: string; src: PaneSrc; device: string; zoom: number | 'fit'; rotate: boolean; devtools: boolean; custom?: { w: number; h: number }; title?: string }

interface WebviewEl extends HTMLElement {
  getWebContentsId(): number; reload(): void; goBack(): void; goForward(): void; canGoBack(): boolean; canGoForward(): boolean; loadURL(u: string): Promise<void>;
  setZoomFactor(f: number): void; getURL(): string; getTitle(): string; openDevTools(): void; isDevToolsOpened(): boolean; closeDevTools(): void; executeJavaScript(code: string): Promise<unknown>;
}

type PaneProps = { pane: PaneState; session?: PreviewSession; focused: boolean; onFocus: () => void; onChange: (p: Partial<PaneState>) => void; onClose: () => void; dtHeight?: number };

/** 舞台每次收到存储 / 任务推送都会重渲染；窗格（iframe + F12 面板）只在自己的数据变化时才重渲染。
 *  回调由 Stage 通过 ref 转发到最新实现，所以比较时可以忽略函数引用。 */
export const Pane = memo(PaneImpl, (a, b) => a.pane === b.pane && a.session === b.session && a.focused === b.focused && a.dtHeight === b.dtHeight);

function PaneImpl({ pane, session, focused, onFocus, onChange, onClose, dtHeight = 260 }: PaneProps) {
  const box = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const wv = useRef<WebviewEl>(null);
  const [wcId, setWcId] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [addr, setAddr] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [src, setSrc] = useState(session?.url || '');
  const [full, setFull] = useState(false);
  const [probe, setProbe] = useState<any | null>(null);
  const [probing, setProbing] = useState(false);
  const nav = useBus<{ url: string; title?: string }>(session ? navKey(session.id) : 'nav:none')[0];
  const logs = useBus<LogEntry>(session ? logKey(session.id) : 'log:none');
  const errs = logs.filter((l) => l.level === 'error' || l.level === 'resource').length;
  const D = desktop();
  const isDesk = !!D && pane.src.type === 'session';

  useEffect(() => { if (session?.url) { setSrc(session.url); setLoading(true); } }, [session?.url]);
  useEffect(() => { if (nav?.url && !editing) setAddr(nav.url); }, [nav?.url, editing]);
  useEffect(() => { if (!editing && !nav?.url) setAddr(src); }, [src]); // eslint-disable-line

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  // 来自页面探针的 postMessage：导航、性能、视口信息
  useEffect(() => {
    if (!session) return;
    const h = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || d.__wb !== 'evt' || d.sid !== session.id) return;
      if (d.type === 'nav') { bus.set(navKey(session.id), [{ url: d.url, title: d.title }]); setLoading(false); }
      else if (d.type === 'perf') bus.append(perfKey(session.id), [{ fps: d.fps, mem: d.mem, nodes: d.nodes, ts: Date.now() }], 120);
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [session?.id]); // eslint-disable-line

  const cmd = useCallback((type: string, extra: Record<string, unknown> = {}) => {
    frame.current?.contentWindow?.postMessage({ __wb: 'cmd', type, ...extra }, '*');
  }, []);
  useEffect(() => { if (pane.devtools && session?.inject && !isDesk) { const t = setTimeout(() => cmd('perf', { on: true }), 600); return () => clearTimeout(t); } }, [pane.devtools, session?.id, loading]); // eslint-disable-line

  // 桌面版：webview 事件（原生控制台、加载失败、导航）
  useEffect(() => {
    const el = wv.current;
    if (!el || !isDesk || !session) return;
    const ready = () => { try { setWcId(el.getWebContentsId()); } catch { /* */ } setLoading(false); };
    const cm = (e: any) => {
      if (session.inject && e.level < 2) return; // 注入探针的会话由探针上报 log/info，原生只补充警告与错误
      const lvl = ['log', 'info', 'warn', 'error'][e.level] || 'log';
      void post(`/api/preview/${session.id}/logs`, { entries: [{ level: lvl, text: e.message, url: e.sourceId, line: e.line, src: 'native' }] });
    };
    const fail = (e: any) => { if (e.errorCode !== -3) void post(`/api/preview/${session.id}/logs`, { entries: [{ level: 'error', text: `加载失败 ${e.errorCode} ${e.errorDescription}：${e.validatedURL}`, src: 'native' }] }); setLoading(false); };
    const nv = (e: any) => { bus.set(navKey(session.id), [{ url: e.url, title: el.getTitle?.() }]); };
    const start = () => setLoading(true);
    const stop = () => setLoading(false);
    el.addEventListener('dom-ready', ready);
    el.addEventListener('console-message', cm);
    el.addEventListener('did-fail-load', fail);
    el.addEventListener('did-navigate', nv);
    el.addEventListener('did-navigate-in-page', nv);
    el.addEventListener('did-start-loading', start);
    el.addEventListener('did-stop-loading', stop);
    return () => {
      el.removeEventListener('dom-ready', ready); el.removeEventListener('console-message', cm); el.removeEventListener('did-fail-load', fail);
      el.removeEventListener('did-navigate', nv); el.removeEventListener('did-navigate-in-page', nv); el.removeEventListener('did-start-loading', start); el.removeEventListener('did-stop-loading', stop);
    };
  }, [isDesk, session?.id, src]); // eslint-disable-line

  // 尺寸计算
  const dev = pane.device === 'custom' ? { ...DEVICES[1], id: 'custom', label: '自定义', w: pane.custom?.w || 1280, h: pane.custom?.h || 800, mobile: (pane.custom?.w || 1280) < 820 } : deviceById(pane.device);
  const fill = dev.id === 'fill';
  let W = pane.rotate ? dev.h : dev.w, H = pane.rotate ? dev.w : dev.h;
  const pad = fill ? 0 : 24;
  const availW = Math.max(50, size.w - pad * 2), availH = Math.max(50, size.h - pad * 2);
  let scale: number;
  if (fill) { scale = pane.zoom === 'fit' ? 1 : pane.zoom; W = availW / scale; H = availH / scale; }
  else scale = pane.zoom === 'fit' ? Math.min(1, availW / W, availH / H) : pane.zoom;

  // 桌面版：设备模拟（UA、触摸、DPR）
  useEffect(() => {
    if (!isDesk || wcId == null) return;
    void D!.emulate(wcId, fill ? null : { width: Math.round(W), height: Math.round(H), mobile: dev.mobile, dpr: dev.dpr, ua: dev.ua });
  }, [isDesk, wcId, dev.id, pane.rotate, fill ? 0 : W, fill ? 0 : H]); // eslint-disable-line

  const reload = () => {
    setLoading(true);
    if (isDesk) wv.current?.reload();
    else if (session?.inject) cmd('reload');
    else { const s = src; setSrc('about:blank'); setTimeout(() => setSrc(s), 30); }
  };
  const goAddr = () => {
    setEditing(false);
    let u = addr.trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u) && session?.port) u = `http://127.0.0.1:${session.port}/${u.replace(/^\//, '')}`;
    else if (!/^https?:\/\//.test(u)) u = 'http://' + u;
    setLoading(true);
    if (isDesk) void wv.current?.loadURL(u);
    else setSrc(u + (u === src ? (u.includes('?') ? '&' : '?') + '_r=' + Date.now() : ''));
  };
  const screenshot = async () => {
    if (isDesk && wcId != null) {
      const data = await D!.capture(wcId);
      const p = await D!.saveFile(`${(session?.label || 'preview').replace(/[^\w.-]+/g, '_')}-${W | 0}x${H | 0}.png`, data);
      if (p) toast.ok('截图已保存：' + p);
      return;
    }
    await runProbe();
  };
  const runProbe = async () => {
    if (!session) return;
    setProbing(true);
    try {
      const r = await post<any>('/api/probe', { session: session.id, viewport: `${Math.round(W)}x${Math.round(H)}`, mobile: dev.mobile, wait: 2500 });
      if (r.error) throw new Error(r.error);
      setProbe(r);
    } catch (e: any) { toast.error('无头检查失败：' + e.message); } finally { setProbing(false); }
  };
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen(); };
  const openDevtoolsNative = () => { if (isDesk && wcId != null) void D!.openDevTools(wcId, 'right'); };

  const label = pane.src.type === 'video' ? pane.src.label : session?.label || '（会话已关闭）';
  return (
    <div ref={root} className={cls('pane', focused && 'focused', full && 'is-full')} onMouseDown={onFocus}>
      <div className="pane-bar">
        {pane.src.type === 'session' && (
          <>
            <IconBtn label="后退" size="xs" onClick={() => (isDesk ? wv.current?.goBack() : cmd('back'))} disabled={!session?.inject && !isDesk}><ArrowLeft size={14} /></IconBtn>
            <IconBtn label="前进" size="xs" onClick={() => (isDesk ? wv.current?.goForward() : cmd('forward'))} disabled={!session?.inject && !isDesk}><ArrowRight size={14} /></IconBtn>
            <IconBtn label="刷新" size="xs" onClick={reload}>{loading ? <Spinner size={13} /> : <RotateCw size={14} />}</IconBtn>
            <form className="addr" onSubmit={(e) => { e.preventDefault(); goAddr(); }}>
              <Badge tone={session?.kind === 'proxy' ? 'info' : session?.kind === 'url' ? 'muted' : 'accent'}>{session?.kind === 'proxy' ? '开发服务器' : session?.kind === 'url' ? '外部' : '静态'}</Badge>
              <input value={editing ? addr : addr || src} onFocus={(e) => { setEditing(true); e.currentTarget.select(); }} onBlur={() => setEditing(false)} onChange={(e) => setAddr(e.target.value)} spellCheck={false} aria-label="地址" />
            </form>
          </>
        )}
        {pane.src.type === 'video' && <span className="pane-title ellipsis grow"><b>视频</b> {label}</span>}
        <div className="pane-tools">
          {pane.src.type === 'session' && (
            <>
              <Select size="xs" value={pane.device} onChange={(v) => onChange({ device: v })} label="设备" place="bottom-end"
                options={[...DEVICES.map((d) => ({ value: d.id, label: d.label, group: d.group })), { value: 'custom', label: '自定义尺寸…', group: '自定义' }]} />
              {pane.device === 'custom' && (
                <span className="custom-size">
                  <input className="input sm" type="number" value={pane.custom?.w || 1280} onChange={(e) => onChange({ custom: { w: Number(e.target.value) || 320, h: pane.custom?.h || 800 } })} aria-label="宽" />×
                  <input className="input sm" type="number" value={pane.custom?.h || 800} onChange={(e) => onChange({ custom: { h: Number(e.target.value) || 320, w: pane.custom?.w || 1280 } })} aria-label="高" />
                </span>
              )}
              {!fill && <IconBtn label="旋转（横竖屏）" size="xs" active={pane.rotate} onClick={() => onChange({ rotate: !pane.rotate })}><RotateCcw size={14} /></IconBtn>}
              <IconBtn label="快速切换手机 / 桌面" size="xs" onClick={() => onChange({ device: dev.mobile ? 'd1440' : 'iphone16' })}>{dev.mobile ? <MonitorSmartphone size={14} /> : <Smartphone size={14} />}</IconBtn>
              <Select size="xs" value={String(pane.zoom)} onChange={(v) => onChange({ zoom: v === 'fit' ? 'fit' : Number(v) })} label="缩放" place="bottom-end"
                options={[{ value: 'fit', label: fill ? '100%' : `适应 ${Math.round(scale * 100)}%` }, ...ZOOMS.map((z) => ({ value: String(z), label: `${Math.round(z * 100)}%` }))]} />
              <IconBtn label={isDesk ? '截图（保存 PNG）' : '无头截图 + 报错检查'} size="xs" onClick={() => void screenshot()} disabled={probing}>{probing ? <Spinner size={13} /> : <Camera size={14} />}</IconBtn>
              {!isDesk && <IconBtn label="无头检查（Python Playwright：报错 + 截图）" size="xs" onClick={() => void runProbe()} disabled={probing}><ScanSearch size={14} /></IconBtn>}
              <IconBtn label="控制台 / 网络面板" size="xs" active={pane.devtools} onClick={() => onChange({ devtools: !pane.devtools })}>
                <Terminal size={14} />{errs > 0 && <span className="err-badge">{errs > 99 ? '99+' : errs}</span>}
              </IconBtn>
              {isDesk && <IconBtn label="原生 Chromium DevTools（F12）" size="xs" onClick={openDevtoolsNative}><Bug size={14} /></IconBtn>}
              <IconBtn label="在系统浏览器中打开" size="xs" onClick={() => { const u = nav?.url || src; if (D) void D.openExternal(u); else window.open(u, '_blank', 'noopener'); }}><ExternalLink size={14} /></IconBtn>
            </>
          )}
          <IconBtn label={full ? '退出全屏' : '全屏'} size="xs" onClick={toggleFull}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</IconBtn>
          <IconBtn label="关闭窗格" size="xs" onClick={onClose}><X size={14} /></IconBtn>
        </div>
      </div>
      <div className={cls('pane-body', pane.devtools && 'with-dt')}>
        <div ref={box} className={cls('viewport', fill ? 'fill' : 'framed', dev.mobile && !fill && 'mobile')} onKeyDown={(e) => { if (e.key === 'F12' && isDesk) { e.preventDefault(); openDevtoolsNative(); } }}>
          {pane.src.type === 'video' ? <div className="vp-wrap"><VideoPlayer src={rawUrl(pane.src.path)} name={pane.src.label} /></div>
            : !session ? <div className="center-v muted">预览会话已关闭</div>
            : (
              <div className="device" style={{ width: W * scale, height: H * scale }}>
                <div className="device-inner" style={{ width: W, height: H, transform: `scale(${scale})` }}>
                  {isDesk
                    ? <webview ref={wv as any} src={src} partition="persist:wb-preview" allowpopups={true} style={{ width: '100%', height: '100%', display: 'flex' }} />
                    : <iframe ref={frame} src={src} title={label} onLoad={() => setLoading(false)} allow="autoplay; fullscreen; clipboard-read; clipboard-write; camera; microphone; gamepad; xr-spatial-tracking; accelerometer; gyroscope; midi; web-share" allowFullScreen />}
                </div>
              </div>
            )}
          {pane.src.type === 'session' && session && <div className="size-tag mono">{Math.round(W)} × {Math.round(H)} · {Math.round(scale * 100)}%{dev.mobile ? ' · 移动端' : ''}</div>}
        </div>
        {pane.devtools && session && <DevTools session={session} height={dtHeight} onEval={(code) => { if (isDesk) void wv.current?.executeJavaScript(code).then((v) => post(`/api/preview/${session.id}/logs`, { entries: [{ level: 'log', src: 'eval', text: '› ' + code }, { level: 'result', src: 'eval', text: safeStr(v) }] }), (e) => post(`/api/preview/${session.id}/logs`, { entries: [{ level: 'error', src: 'eval', text: String(e) }] })); else cmd('eval', { code }); }} onClose={() => onChange({ devtools: false })} />}
      </div>
      <Modal open={!!probe} onClose={() => setProbe(null)} title="无头检查结果（Chromium · Playwright）" width={980}>
        {probe && <ProbeResult r={probe} />}
      </Modal>
    </div>
  );
}
const safeStr = (v: unknown) => { try { return typeof v === 'string' ? v : JSON.stringify(v, null, 1) ?? String(v); } catch { return String(v); } };

export function ProbeResult({ r }: { r: any }) {
  return (
    <div className="stack">
      <div className="row gap-s wrap">
        <Badge tone={r.loaded ? 'ok' : 'bad'} dot>{r.loaded ? '加载成功' : '加载失败'}</Badge>
        <Badge tone={r.counts.error ? 'bad' : 'ok'}>{r.counts.error} 个错误</Badge>
        <Badge tone={r.counts.warning ? 'warn' : 'muted'}>{r.counts.warning} 个警告</Badge>
        <Badge tone={r.counts.failed_requests + r.counts.http_errors ? 'bad' : 'muted'}>{r.counts.failed_requests + r.counts.http_errors} 个失败请求</Badge>
        <span className="muted small">{r.viewport.join('×')}{r.mobile ? ' · 移动端' : ''} · {r.ms} ms · {r.title}</span>
      </div>
      {r.load_error && <div className="alert bad">{r.load_error}</div>}
      <div className="grid-2">
        {r.screenshot ? <div className="img-box"><img src={rawUrl(r.screenshot)} alt="截图" /></div> : <div className="muted">无截图</div>}
        <div className="log-list static">
          {[...r.page_errors, ...r.console].map((l: any, i: number) => <div key={i} className={cls('log', `lv-${l.level === 'warning' ? 'warn' : l.level}`)}><span className="log-t">{l.text}</span>{l.url && <span className="log-src">{String(l.url).split('/').pop()}{l.line != null ? ':' + l.line : ''}</span>}</div>)}
          {[...r.failed_requests.map((f: any) => ({ ...f, status: '失败' })), ...r.http_errors].map((f: any, i: number) => <div key={'f' + i} className="log lv-error"><span className="log-t mono">{f.status} {f.method || ''} {f.url} {f.error || ''}</span></div>)}
          {!r.console.length && !r.page_errors.length && !r.failed_requests.length && !r.http_errors.length && <div className="muted small pad">没有任何输出</div>}
        </div>
      </div>
      <p className="muted small">同一检查可在终端运行 <code>wb check {'<文件|ref|URL>'} --viewport {r.viewport.join('x')}{r.mobile ? ' --mobile' : ''} --json</code>，Agent 可直接读取。</p>
      <Btn size="sm" tone="ghost" onClick={() => navigator.clipboard?.writeText(JSON.stringify(r, null, 2))}>复制 JSON</Btn>
    </div>
  );
}
