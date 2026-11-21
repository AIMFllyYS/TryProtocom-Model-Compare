// v1 发布后不可改写；修改约束正文必须新增版本。这里只追加前缀，不重写旧提示词。
export const CONTEXT_POLICY_VERSION = 'context-boundary/v1';
export const CONTEXT_POLICY_START = '<!-- benchmark-context-boundary:v1:start -->';
export const CONTEXT_POLICY_END = '<!-- benchmark-context-boundary:v1:end -->';
export const CONTEXT_POLICY_BLOCK = `${CONTEXT_POLICY_START}
## 本次测评的上下文边界
- 仅依据本题、随题材料、本工作目录内本轮生成的内容及原题允许的公共技术资料独立完成。
- 不检索、读取或引用跨会话记忆、历史对话、其他运行的产物或解题经验，以及评分器、隐藏测试和评分结果；不得通过终端、搜索、浏览器、MCP或子智能体间接获取，也不主动把本轮内容写入共享记忆。
- Skill仅限本题明确提供或指定者；未指定即不用。不调用其他全局或个人技能，不搜索安装新技能，不复制其内容进本目录绕过限制；原题A/C条件不变。
- 原题允许的终端、浏览器、依赖、编译器和工具帮助可正常使用；不借此浏览其他项目或更改个人harness配置。
- 若相关历史信息已自动注入或意外读到，停止继续获取，不引用或据此优化，仍继续交付；在已有的FINAL_MESSAGE.md中说明来源类别和受影响环节，不复述相关内容，不声称已清除污染。子智能体同样遵守。
${CONTEXT_POLICY_END}

`;

export function addContextPolicy(text: string): string {
  return text.startsWith(CONTEXT_POLICY_BLOCK) ? text : CONTEXT_POLICY_BLOCK + text;
}
export function stripContextPolicy(text: string): string {
  if (!text.startsWith(CONTEXT_POLICY_BLOCK)) throw new Error('缺少或已改动上下文约束段');
  const rest = text.slice(CONTEXT_POLICY_BLOCK.length);
  if (rest.includes(CONTEXT_POLICY_START)) throw new Error('上下文约束段重复');
  return rest;
}
export function contextPolicyVersion(text: string): string {
  try { stripContextPolicy(text); return CONTEXT_POLICY_VERSION; }
  catch { return text.includes('benchmark-context-boundary:') ? 'unknown' : 'legacy'; }
}
export function contextPolicyWarnings(text: string): string[] {
  const version = contextPolicyVersion(text);
  return version === 'legacy' ? ['旧版约束，未增强：保留原提示词；采用新增约束请显式创建新运行。']
    : version === 'unknown' ? ['约束版本未知或正文被改动，请在发送前核对存档。'] : [];
}

export interface SkillSnapshot {
  mode: 'none' | 'provided';
  names: string[];
  roots: string[];
  status: 'not_applicable' | 'pending' | 'recorded' | 'unknown';
  files?: Record<string, string>;
  captured_at?: string;
  source: string;
}
export interface ContextAuditReport {
  schema: 'context-audit/1'; ref: string | null; run_id: string | null; policy_version: string;
  coverage: { tools: 'missing' | 'partial' | 'parseable'; initial_context: string };
  prompt_provenance: { archive: string; sent: string };
  pending_count: number; stale: boolean; report_file?: string;
  inputs?: { path: string; sha256: string | null; size?: number; mtime_ns?: string }[];
  sources: { path: string; sha256: string | null; size?: number; mtime_ns?: string; association: string }[];
  findings: { id: string; evidence_id: string; finding_kind: string; observation: string; review_state: string; review_note?: string; source: string; line: number; summary: string; target?: string }[];
}
export interface ContextPolicyRecord {
  version: string; generator_version: string; policy_sha256: string;
  base_prompt_sha256: string; prompt_sha256: string; task_prompt_sha256: string;
  insertion: { offset: number; byte_length: number }; header_enabled: boolean;
  skills: SkillSnapshot;
  launched_at?: string;
  materials?: { status: 'recorded' | 'unknown'; files: Record<string, string>; captured_at: string };
}

/** 复制失败只影响交接提示，不重发车、不回滚计时。 */
export async function copyAuthoritativePrompt(preview: string, final: string, firstCopied: boolean, copy: (s: string) => Promise<boolean>): Promise<boolean> {
  if (preview === final && firstCopied) return true;
  try { return await copy(final); } catch { return false; }
}
