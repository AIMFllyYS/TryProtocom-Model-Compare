import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONTEXT_POLICY_BLOCK, CONTEXT_POLICY_VERSION, stripContextPolicy, type ContextPolicyRecord, type SkillSnapshot } from '../shared/context-policy';

const hash = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
const VIDEO_SKILLS = ['hyperframes', 'hyperframes-core', 'hyperframes-cli', 'hyperframes-animation', 'hyperframes-keyframes', 'hyperframes-audio', 'hyperframes-registry', 'hyperframes-creative', 'hyperframes-studio', 'hyperframes-media', 'media-use', 'general-video', 'product-launch-video', 'gsap'];

export function declaredSkills(task: string, variant: string | null): SkillSnapshot {
  const minecraft = ['T02', 'V03'].includes(task);
  const video = ['T04', 'V08'].includes(task) || (['T03', 'V07'].includes(task) && variant === 'C');
  const names = minecraft ? ['minecraft-stop-motion-director'] : video ? VIDEO_SKILLS : [];
  return { mode: names.length ? 'provided' : 'none', names, roots: [], status: names.length ? 'pending' : 'not_applicable', source: minecraft ? '题目随附技能包' : video ? '题目指定 HyperFrames 官方技能，本地快照' : '题目未指定技能' };
}

/** 只读取明确允许的工作区内技能，不跟随符号链接/目录联接。 */
export function snapshotSkills(workspace: string, current: SkillSnapshot): SkillSnapshot {
  if (current.mode === 'none') return current;
  const roots: string[] = [], files: Record<string, string> = {};
  let unsafe = false;
  const safe = (p: string) => {
    const rel = path.relative(fs.realpathSync(workspace), fs.realpathSync(p));
    return !rel.startsWith('..') && !path.isAbsolute(rel) && !fs.lstatSync(p).isSymbolicLink() && !path.relative(path.resolve(p), fs.realpathSync(p));
  };
  const walk = (p: string) => {
    if (!safe(p)) { unsafe = true; return; }
    const stat = fs.lstatSync(p);
    if (stat.isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
    else if (stat.isFile()) files[path.relative(workspace, p).split(path.sep).join('/')] = hash(fs.readFileSync(p));
  };
  try {
    for (const base of ['skills', '.agents/skills']) for (const name of current.names) {
      const rel = `${base}/${name}`, p = path.join(workspace, rel);
      if (!fs.existsSync(p)) continue;
      if (!safe(p)) { unsafe = true; continue; }
      const entry = path.join(p, 'SKILL.md');
      if (fs.existsSync(entry)) { roots.push(rel); walk(p); }
    }
  } catch { unsafe = true; }
  const required = current.names[0];
  const present = roots.some((r) => r.endsWith('/' + required));
  return { ...current, roots, files, status: unsafe ? 'unknown' : present ? 'recorded' : 'pending', captured_at: new Date().toISOString() };
}

function snapshotMaterials(workspace: string): NonNullable<ContextPolicyRecord['materials']> {
  const snapshot: NonNullable<ContextPolicyRecord['materials']> = { status: 'recorded', files: {}, captured_at: new Date().toISOString() };
  const walk = (p: string) => {
    if (fs.lstatSync(p).isSymbolicLink() || path.relative(path.resolve(p), fs.realpathSync(p))) { snapshot.status = 'unknown'; return; }
    if (fs.lstatSync(p).isDirectory()) {
      for (const name of fs.readdirSync(p)) if (name !== '.git') walk(path.join(p, name));
    } else if (fs.lstatSync(p).isFile()) snapshot.files[path.relative(workspace, p).split(path.sep).join('/')] = hash(fs.readFileSync(p));
  };
  try { walk(workspace); } catch { snapshot.status = 'unknown'; }
  return snapshot;
}

export function makeContextPolicy(text: string, raw: string, task: string, variant: string | null, workspace: string): ContextPolicyRecord | undefined {
  if (!text.startsWith(CONTEXT_POLICY_BLOCK)) return undefined;
  const baseline = stripContextPolicy(text);
  return { version: CONTEXT_POLICY_VERSION, generator_version: 'context-generator/1', policy_sha256: hash(CONTEXT_POLICY_BLOCK),
    base_prompt_sha256: hash(baseline), prompt_sha256: hash(text), task_prompt_sha256: hash(raw),
    insertion: { offset: 0, byte_length: Buffer.byteLength(CONTEXT_POLICY_BLOCK) }, header_enabled: baseline.startsWith('# 运行约定'),
    skills: snapshotSkills(workspace, declaredSkills(task, variant)), materials: snapshotMaterials(workspace) };
}
