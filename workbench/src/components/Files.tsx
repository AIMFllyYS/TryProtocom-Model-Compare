// 文件浏览：列出仓库内允许的目录（model/、bench-data/、reports/…），就地预览图片、视频、音频、文本 / Markdown，HTML 送到预览舞台。
import { useEffect, useRef, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Download, File, FileCode2, FileImage, FileVideo, Folder, FolderOpen, MonitorPlay, RefreshCw } from 'lucide-react';
import { get, post, rawUrl } from '../api';
import { go } from '../lib/router';
import { cls, fmt, isAudio, isHtml, isImage, isText, isVideo } from '../lib/format';
import { Markdown } from '../lib/markdown';
import { Btn, IconBtn, Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { VideoPlayer } from './VideoPlayer';
import { ExplorerTree, type ExplorerNode } from './ExplorerTree';

interface Ent { name: string; dir: boolean; size: number; mtime: number; path: string }

export function FileBrowser(props: { root: string; title?: string; onOpenHtml?: (path: string) => void; onOpenVideo?: (path: string, label: string) => void; active?: boolean; height?: number }) {
  return <FileExplorer key={props.root} {...props} />;
}

function FileExplorer({ root, title, onOpenHtml, onOpenVideo, active = true, height = 520 }: { root: string; title?: string; onOpenHtml?: (path: string) => void; onOpenVideo?: (path: string, label: string) => void; active?: boolean; height?: number }) {
  const cache = useRef(new Map<string, Ent[]>());
  const pending = useRef(new Map<string, Promise<Ent[]>>());
  const errors = useRef(new Map<string, string>());
  const generation = useRef(0);
  const expanding = useRef(false);
  const expansionId = useRef(0);
  const [, redraw] = useState(0);
  const [expanded, setExpanded] = useState(new Set([root]));
  const [selected, setSelected] = useState<Ent | null>(null);
  const [folder, setFolder] = useState(root);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const render = () => redraw((n) => n + 1);
  const load = (path: string): Promise<Ent[]> => {
    if (cache.current.has(path)) return Promise.resolve(cache.current.get(path)!);
    if (pending.current.has(path)) return pending.current.get(path)!;
    const version = generation.current;
    errors.current.delete(path);
    const request = get<{ entries: Ent[] }>('/api/fs/list', { path }).then((data) => {
      if (generation.current !== version) return [];
      // The file API exposes only workbench/.runtime, not the rest of workbench.
      if (path === '') {
        const wb = data.entries.find((e) => e.path === 'workbench' && e.dir);
        if (wb) cache.current.set('workbench', [{ ...wb, name: '.runtime', path: 'workbench/.runtime' }]);
      }
      cache.current.set(path, data.entries); return data.entries;
    }, (e) => { if (generation.current === version) errors.current.set(path, e.message); return []; }).finally(() => {
      if (generation.current === version) { pending.current.delete(path); render(); }
    });
    pending.current.set(path, request); render(); return request;
  };
  useEffect(() => { void load(root); return () => { generation.current++; pending.current.clear(); expanding.current = false; }; }, []); // eslint-disable-line
  const toggle = (path: string) => {
    setFolder(path);
    const retry = errors.current.has(path);
    if (!expanded.has(path) || retry) void load(path);
    setExpanded((old) => { const next = new Set(old); if (next.has(path) && !retry) next.delete(path); else next.add(path); return next; });
  };
  const expandAll = async () => {
    if (expanding.current) { expanding.current = false; expansionId.current++; setBusy(false); return; }
    expanding.current = true; setBusy(true); setProgress(0);
    const version = generation.current;
    const operation = ++expansionId.current;
    const queue = [root], visited = new Set<string>();
    while (queue.length && expanding.current && operation === expansionId.current && generation.current === version) {
      const batch = queue.splice(0, 4).filter((path) => !visited.has(path));
      batch.forEach((path) => visited.add(path));
      const children = await Promise.all(batch.map(load));
      if (!expanding.current || operation !== expansionId.current || generation.current !== version) break;
      setExpanded((old) => new Set([...old, ...batch]));
      setProgress(visited.size);
      children.forEach((entries) => entries.filter((e) => e.dir).forEach((e) => queue.push(e.path)));
    }
    if (generation.current === version && operation === expansionId.current) { expanding.current = false; setBusy(false); }
  };
  const openHtml = (path: string) => onOpenHtml ? onOpenHtml(path) : go('stage', [], { path });
  const activate = (path: string) => {
    const entry = [...cache.current.values()].flat().find((e) => e.path === path);
    if (!entry || entry.dir) return;
    setSelected(entry);
    if (isHtml(entry.name)) openHtml(path);
    else if (isVideo(entry.name) && onOpenVideo) onOpenVideo(path, entry.name);
  };
  const treeNodes = (entries: Ent[]): ExplorerNode[] => entries.map((e) => ({
    id: e.path, label: e.name, title: e.path, branch: e.dir, loading: pending.current.has(e.path),
    icon: e.dir ? undefined : iconOf(e),
    meta: errors.current.has(e.path) ? <span className="tone-text-bad" title={errors.current.get(e.path)}>加载失败 · 点击重试</span> : !e.dir ? fmt.bytes(e.size) : cache.current.has(e.path) ? `${cache.current.get(e.path)!.length} 项` : undefined,
    children: e.dir && expanded.has(e.path) ? treeNodes(cache.current.get(e.path) || []) : undefined,
  }));
  const nodes: ExplorerNode[] = [{ id: root, label: title || root.split('/').pop() || '仓库', branch: true, loading: pending.current.has(root), children: treeNodes(cache.current.get(root) || []) }];
  const selectFile = (path: string) => { const entry = [...cache.current.values()].flat().find((e) => e.path === path); if (entry) setSelected(entry); };
  return <div className="files repository-explorer" style={{ height }}>
    <div className="files-l">
      <div className="explorer-toolbar files-bar">
        <Btn size="xs" tone="ghost" icon={<ChevronsUpDown size={13} />} onClick={() => void expandAll()}>{busy ? '停止展开' : '全部展开'}</Btn>
        <Btn size="xs" tone="ghost" icon={<ChevronsDownUp size={13} />} onClick={() => { expanding.current = false; expansionId.current++; setBusy(false); setExpanded(new Set([root])); }}>全部折叠</Btn>
        <div className="grow" />
        <IconBtn label="刷新文件树" size="xs" onClick={() => { expanding.current = false; setBusy(false); generation.current++; cache.current.clear(); pending.current.clear(); errors.current.clear(); setSelected(null); void load(root); }}><RefreshCw size={13} /></IconBtn>
      </div>
      {busy && <div className="explorer-caption">正在展开目录 · {progress} 个</div>}
      {errors.current.has(root) && <div className="muted small pad">{errors.current.get(root)} <Btn size="xs" onClick={() => void load(root)}>重试</Btn></div>}
      <ExplorerTree label="仓库文件" nodes={nodes} expanded={expanded} onToggle={toggle} selected={selected?.path} onSelect={selectFile} onActivate={activate} />
      <div className="explorer-caption file-tree-footer"><span className="ellipsis" title={selected?.path || folder}>{selected?.path || folder || '仓库根目录'}</span></div>
    </div>
    <div className="files-r">{!active ? null : selected ? <FilePreview key={selected.path} e={selected} onOpenHtml={openHtml} onOpenVideo={onOpenVideo} /> : <div className="file-preview-empty"><File size={28} /><b>选择文件查看内容</b><span>展开目录，单击文件直接预览</span><span>双击 HTML 或视频在舞台打开</span></div>}</div>
  </div>;
}

function iconOf(e: Ent) {
  if (e.dir) return <Folder size={15} className="ic-dir" />;
  if (isVideo(e.name)) return <FileVideo size={15} className="ic-vid" />;
  if (isImage(e.name)) return <FileImage size={15} className="ic-img" />;
  if (isHtml(e.name) || isText(e.name)) return <FileCode2 size={15} className="ic-code" />;
  return <File size={15} className="muted" />;
}

export function FilePreview({ e, onOpenHtml, onOpenVideo }: { e: { path: string; name: string; size: number }; onOpenHtml?: (p: string) => void; onOpenVideo?: (p: string, label: string) => void }) {
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
        {isVideo(e.name) && onOpenVideo && <Btn size="xs" tone="primary" onClick={() => onOpenVideo(e.path, e.name)}>在舞台播放</Btn>}
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
