// 每道题的交付清单：统一提示词里的“必须存在的文件”、服务端交付检测、预览入口都以此为准。
// 与 tasks/*/prompt.md 的「交付」段一致；修改题目时同步这里。

export interface DeliverFile {
  path: string;            // 相对交付文件夹；any 时为展示名
  label?: string;
  dir?: boolean;           // 期望是目录
  any?: string[];          // 任一存在即可（例如多种 lock 文件）
  optional?: boolean;
}
export type DeliverKind = 'web' | 'video' | 'api' | 'repo';
export interface Deliverable { dir: string; kind: DeliverKind; files: DeliverFile[]; preview?: string; note?: string }

export const FINAL_FILE = 'FINAL_MESSAGE.md';
const LOCKS = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'requirements.txt', 'uv.lock', 'poetry.lock'];

export const DELIVERABLES: Record<string, Deliverable> = {
  T01: { dir: 'pelican-bike', kind: 'web', preview: 'index.html', files: [{ path: 'index.html', label: '单文件页面（代码全部内联）' }] },
  T02: {
    dir: 'mc-sol-luna', kind: 'web', preview: 'index.html', files: [
      { path: 'index.html', label: '单文件成片' }, { path: 'project.json' }, { path: 'shot-list.json' }, { path: 'audio-cue-sheet.csv' },
      { path: 'qc-report.md' }, { path: 'delivery-manifest.json' }, { path: 'keyframes', dir: true, label: 'keyframes/ 关键帧' },
      { path: 'contact-sheet.jpg', optional: true, label: 'contact-sheet.jpg（无法截图时在 qc-report.md 说明）' },
    ],
  },
  T03: { dir: 'tempo-promo', kind: 'web', preview: 'index.html', files: [{ path: 'index.html', label: '可直接打开的成片页面（window.__hf）' }, { path: '*.mp4', any: [], optional: true, label: '导出的 MP4（可选）' }] },
  T04: { dir: 'aether9-promo', kind: 'video', preview: 'final.mp4', files: [{ path: 'final.mp4' }, { path: 'subtitles.srt' }, { path: 'script.md', label: 'script.md 旁白脚本' }] },
  T05: {
    dir: 'aether9-site', kind: 'web', preview: 'dist/index.html', files: [
      { path: 'package.json' }, { path: 'lock', any: LOCKS.slice(0, 5), label: 'lock 文件（npm / pnpm / yarn / bun）' }, { path: 'dist/index.html', label: '构建产物 dist/index.html（单文件 ≤ 8 MB）' },
    ],
  },
  T06: { dir: 'studyspot-web', kind: 'web', preview: 'index.html', files: [{ path: 'index.html', label: '单文件页面（window.__bench）' }, { path: 'ASSUMPTIONS.md', label: 'ASSUMPTIONS.md 需求理解与假设' }] },
  T07: {
    dir: 'studyspot-api', kind: 'api', preview: 'README.md', files: [
      { path: 'bench.json', label: 'bench.json 启动约定' }, { path: 'lock', any: LOCKS, label: '依赖清单 / lock 文件' }, { path: 'README.md' }, { path: 'DECISIONS.md' },
    ],
  },
  T08: { dir: 'studyspot-legacy', kind: 'repo', preview: 'FIXES.md', note: '直接修改预置的 studyspot-legacy/', files: [{ path: 'FIXES.md', label: 'FIXES.md 修复记录（新增）' }, { path: 'tests', dir: true, label: 'tests/ 回归测试' }] },
};

export const deliverableFor = (task: string, fallbackDir?: string): Deliverable =>
  DELIVERABLES[task] || { dir: fallbackDir || '', kind: 'web', files: [], preview: 'index.html' };

export interface DeliverCheck { path: string; label: string; ok: boolean; optional: boolean; found?: string }
export interface DetectResult { dir_exists: boolean; checks: DeliverCheck[]; done: number; total: number; final: boolean; last_change: number | null }

/** 用一个“存在性查询”函数计算清单（服务端传入 fs 版本，测试时可传假实现）。 */
export function evalDeliverable(d: Deliverable, exists: (rel: string, dir?: boolean) => boolean, list: (rel: string) => string[]): DeliverCheck[] {
  return d.files.map((f) => {
    const label = f.label || f.path;
    if (f.path.startsWith('*.')) {
      const ext = f.path.slice(1).toLowerCase();
      const hit = list(d.dir).find((x) => x.toLowerCase().endsWith(ext));
      return { path: f.path, label, ok: !!hit, optional: !!f.optional, found: hit };
    }
    if (f.any) {
      const hit = f.any.find((a) => exists(`${d.dir}/${a}`));
      return { path: f.path, label, ok: !!hit, optional: !!f.optional, found: hit };
    }
    return { path: f.path, label, ok: exists(`${d.dir}/${f.path}`, f.dir), optional: !!f.optional };
  });
}
