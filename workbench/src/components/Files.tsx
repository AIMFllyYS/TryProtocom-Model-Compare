// 文件浏览：列出仓库内允许的目录（model/、bench-data/、reports/…），就地预览图片、视频、音频、文本 / Markdown，HTML 送到预览舞台。
import { useEffect, useState } from 'react';
import { ChevronRight, Download, File, FileCode2, FileImage, FileVideo, Folder, FolderOpen, MonitorPlay, RefreshCw } from 'lucide-react';
import { get, post, rawUrl } from '../api';
import { go } from '../lib/router';
import { cls, fmt, isAudio, isHtml, isImage, isText, isVideo } from '../lib/format';
import { Markdown } from '../lib/markdown';
import { Btn, IconBtn, Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { VideoPlayer } from './VideoPlayer';

interface Ent { name: string; dir: boolean; size: number; mtime: number; path: string }

export function FileBrowser({ root, title, onOpenHtml, height = 520 }: { root: string; title?: string; onOpenHtml?: (path: string) => void; height?: number }) {
  const [cwd, setCwd] = useState(root);
  const [ents, setEnts] = useState<Ent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Ent | null>(null);
  const load = (p = cwd) => {
    setEnts(null); setErr(null);
    get<{ entries: Ent[] }>('/api/fs/list', { path: p }).then((r) => setEnts(r.entries), (e) => setErr(e.message));
  };
  useEffect(() => { setCwd(root); setSel(null); }, [root]);
  useEffect(() => { load(cwd); }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps
  const crumbs = cwd.slice(root.length).split('/').filter(Boolean);
  const open = (e: Ent) => { if (e.dir) { setCwd(e.path); setSel(null); } else setSel(e); };
  const openHtml = (p: string) => onOpenHtml ? onOpenHtml(p) : go('stage', [], { path: p });
  return (
    <div className="files" style={{ height }}>
      <div className="files-l">
        <div className="files-bar">
          <button className="crumb" onClick={() => setCwd(root)}>{title || root.split('/').pop()}</button>
          {crumbs.map((c, i) => <span key={i} className="row"><ChevronRight size={12} className="muted" /><button className="crumb" onClick={() => setCwd(root + '/' + crumbs.slice(0, i + 1).join('/'))}>{c}</button></span>)}
          <div className="grow" />
          <IconBtn label="刷新" size="xs" onClick={() => load()}><RefreshCw size={13} /></IconBtn>
          <IconBtn label="在资源管理器中打开" size="xs" onClick={() => void post('/api/open-folder', { path: cwd }).catch((e) => toast.error(e.message))}><FolderOpen size={13} /></IconBtn>
        </div>
        <div className="files-list">
          {err && <div className="muted small pad">{err.includes('不存在') ? '目录还不存在（模型尚未产出文件）' : err}</div>}
          {!ents && !err && <div className="pad"><Spinner /></div>}
          {ents?.length === 0 && <div className="muted small pad">空目录</div>}
          {ents?.map((e) => (
            <button key={e.path} className={cls('file-i', sel?.path === e.path && 'on')} onClick={() => open(e)} onDoubleClick={() => !e.dir && isHtml(e.name) && openHtml(e.path)}>
              {iconOf(e)}
              <span className="grow ellipsis">{e.name}</span>
              <span className="muted xs">{e.dir ? '' : fmt.bytes(e.size)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="files-r">{sel ? <FilePreview e={sel} onOpenHtml={openHtml} /> : <div className="muted small pad center-v">选择文件预览 · 双击 HTML 在舞台打开</div>}</div>
    </div>
  );
}

function iconOf(e: Ent) {
  if (e.dir) return <Folder size={15} className="ic-dir" />;
  if (isVideo(e.name)) return <FileVideo size={15} className="ic-vid" />;
  if (isImage(e.name)) return <FileImage size={15} className="ic-img" />;
  if (isHtml(e.name) || isText(e.name)) return <FileCode2 size={15} className="ic-code" />;
  return <File size={15} className="muted" />;
}

export function FilePreview({ e, onOpenHtml }: { e: { path: string; name: string; size: number }; onOpenHtml?: (p: string) => void }) {
  const [txt, setTxt] = useState<{ text: string; truncated: boolean; binary: boolean } | null>(null);
  const textual = isText(e.name) || isHtml(e.name);
  useEffect(() => {
    setTxt(null);
    if (textual && e.size < 3 * 1024 * 1024) get<{ text: string; truncated: boolean; binary: boolean }>('/api/fs/read', { path: e.path }).then(setTxt, () => setTxt({ text: '读取失败', truncated: false, binary: false }));
  }, [e.path]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fprev">
      <div className="fprev-h">
        <span className="mono small ellipsis grow" title={e.path}>{e.name}</span>
        {isHtml(e.name) && <Btn size="xs" tone="primary" icon={<MonitorPlay size={13} />} onClick={() => onOpenHtml?.(e.path)}>在舞台打开</Btn>}
        <a className="btn xs ghost" href={rawUrl(e.path, true)}><Download size={13} /><span>下载</span></a>
      </div>
      <div className="fprev-b">
        {isVideo(e.name) ? <VideoPlayer src={rawUrl(e.path)} name={e.name} />
          : isAudio(e.name) ? <audio controls src={rawUrl(e.path)} style={{ width: '100%' }} />
          : isImage(e.name) ? <div className="img-box"><img src={rawUrl(e.path)} alt={e.name} /></div>
          : textual ? (!txt ? <Spinner /> : /\.md$/i.test(e.name) ? <Markdown text={txt.text} /> : <pre className="code">{txt.text}{txt.truncated ? '\n…（已截断）' : ''}</pre>)
          : <div className="muted small">无法内联预览（{fmt.bytes(e.size)}），可下载查看。</div>}
      </div>
    </div>
  );
}
