// 只读取独立报告；GET 不启动 Python、不扫描日志、不写存储文件。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import type { Config } from './config';
import type { ContextAuditReport } from '../shared/context-policy';

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
function safe(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return false;
  try { return !fs.lstatSync(p).isSymbolicLink() && !path.relative(p, fs.realpathSync(p)); } catch { return false; }
}
function read(root: string, file: string): any {
  try { return safe(root, file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; }
}

export function readContextReport(data: string, target: string): ContextAuditReport | null {
  const root = path.join(data, 'context-audits'), dir = path.join(root, hash(target));
  if (!safe(data, root) || !safe(root, dir)) return null;
  const idx = read(root, path.join(dir, 'current.json'));
  if (!/^report-[a-f0-9]+\.json$/.test(idx?.report || '')) return null;
  const file = path.join(dir, idx.report);
  const report: ContextAuditReport | null = read(root, file);
  if (!report || report.schema !== 'context-audit/1') return null;
  report.report_file = file;
  report.stale = [...report.sources, ...(report.inputs || [])].some((s) => {
    try { const st = fs.statSync(s.path, { bigint: true }); return Number(st.size) !== s.size || String(st.mtimeNs) !== s.mtime_ns; } catch { return true; }
  });
  const reviews = fs.readdirSync(dir).filter((n) => /^review-[a-f0-9]+\.json$/.test(n)).map((n) => read(root, path.join(dir, n))).filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const f of report.findings) for (const r of reviews) {
    if (r.finding_id === f.id && r.evidence_id === f.evidence_id && ['confirmed', 'dismissed'].includes(r.decision)) {
      f.review_state = r.decision; f.review_note = r.note;
    }
  }
  report.pending_count = report.findings.filter((f) => f.review_state === 'pending').length;
  return report;
}

export function listContextReports(data: string): ContextAuditReport[] {
  const root = path.join(data, 'context-audits');
  if (!safe(data, root)) return [];
  const out: ContextAuditReport[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const dir = path.join(root, name);
    const index = read(root, path.join(dir, 'current.json'));
    // 旧索引缺身份时从明确的报告文件读取身份；不扫描其他目录。
    const report = /^report-[a-f0-9]+\.json$/.test(index?.report || '') ? read(root, path.join(dir, index.report)) : null;
    const target = index?.ref || index?.run_id || report?.ref || report?.run_id;
    if (!target || hash(target) !== name) continue;
    const full = readContextReport(data, target);
    if (full) out.push(full);
  }
  return out;
}

/** 登记成功后触发一次；与评分独立，不进入串行评分队列，也不触发全库 sync。 */
export function auditAfterRegistration(cfg: Config, ref: string, done: (error?: string) => void): void {
  if (!cfg.python) { done('Python 不可用，审计未运行'); return; }
  const script = path.join(cfg.graderDir, 'scripts', 'audit_context.py');
  if (!fs.existsSync(script)) { done('审计脚本不可用'); return; }
  execFile(cfg.python, ['-B', script, '--root', cfg.root, '--data', cfg.benchData, '--model-dir', cfg.modelDir, 'audit', ref, '--save', '--json'],
    { cwd: cfg.root, timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
    (error) => done(error ? '审计失败或超时，可用 wb context audit 重试；登记与评分不受影响' : undefined));
}
