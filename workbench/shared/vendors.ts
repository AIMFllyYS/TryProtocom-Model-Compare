// 供应商推断、品牌图标与 harness（Agent 软件）目录。前后端共享。
// 图标来自 Lobe Icons（MIT），已下载到 workbench/public/brands/，离线可用。

export interface VendorDef {
  id: string;          // 目录名，例如 OpenAI
  name: string;        // 显示名
  cn?: string;
  icon: string;        // public/brands/<icon>.svg
  color: string;       // 品牌色（用于雷达/图例），深浅主题均可读
  match: RegExp;       // 从模型名推断供应商
}

/** 单色图标（SVG 使用 currentColor），前端用 CSS mask 着色；其余为彩色，直接 <img>。 */
export const MONO_ICONS = new Set([
  'anthropic', 'apple', 'aws', 'cline', 'cursor', 'github', 'githubcopilot', 'grok', 'hermesagent', 'inflection', 'kimi', 'kwaikat',
  'liquid', 'longcat', 'moonshot', 'nousresearch', 'openai', 'opencode', 'qoder', 'reka', 'windsurf', 'xai', 'xiaomimimo', 'yi', 'zai', 'zeroone',
]);

export const VENDORS: VendorDef[] = [
  { id: 'OpenAI', name: 'OpenAI', icon: 'openai', color: '#10a37f', match: /^(gpt|o\d|chatgpt|codex|openai|davinci|sora)/i },
  { id: 'Anthropic', name: 'Anthropic', icon: 'anthropic', color: '#d97757', match: /^(claude|anthropic|opus|sonnet|haiku)/i },
  { id: 'Google', name: 'Google', icon: 'google', color: '#4285f4', match: /^(gemini|gemma|palm|bard|google|veo|imagen)/i },
  { id: 'DeepSeek', name: 'DeepSeek', cn: '深度求索', icon: 'deepseek', color: '#4d6bfe', match: /^deepseek/i },
  { id: 'Alibaba', name: 'Alibaba Qwen', cn: '通义千问', icon: 'qwen', color: '#615ced', match: /^(qwen|qwq|qvq|tongyi|alibaba)/i },
  { id: 'Zhipu', name: 'Zhipu · Z.ai', cn: '智谱', icon: 'zhipu', color: '#3859ff', match: /^(glm|chatglm|codegeex|zhipu|z\.?ai)/i },
  { id: 'Moonshot', name: 'Moonshot', cn: '月之暗面', icon: 'kimi', color: '#1783ff', match: /^(kimi|moonshot)/i },
  { id: 'xAI', name: 'xAI', icon: 'xai', color: '#9aa4b2', match: /^(grok|xai)/i },
  { id: 'ByteDance', name: 'ByteDance Seed', cn: '字节跳动', icon: 'doubao', color: '#3c8cff', match: /^(doubao|seed|bytedance|skylark)/i },
  { id: 'MiniMax', name: 'MiniMax', icon: 'minimax', color: '#f23f5d', match: /^(minimax|abab|hailuo)/i },
  { id: 'Xiaomi', name: 'Xiaomi MiMo', cn: '小米', icon: 'xiaomimimo', color: '#ff6900', match: /^(mimo|xiaomi)/i },
  { id: 'Tencent', name: 'Tencent Hunyuan', cn: '腾讯混元', icon: 'hunyuan', color: '#0052d9', match: /^(hunyuan|tencent|hy-)/i },
  { id: 'Baidu', name: 'Baidu ERNIE', cn: '文心', icon: 'wenxin', color: '#2932e1', match: /^(ernie|wenxin|baidu)/i },
  { id: 'StepFun', name: 'StepFun', cn: '阶跃星辰', icon: 'stepfun', color: '#01a9e0', match: /^(step|stepfun)/i },
  { id: 'Mistral', name: 'Mistral AI', icon: 'mistral', color: '#fa520f', match: /^(mistral|codestral|devstral|magistral|mixtral|ministral|pixtral)/i },
  { id: 'Meta', name: 'Meta Llama', icon: 'meta', color: '#0668e1', match: /^(llama|meta)/i },
  { id: 'NVIDIA', name: 'NVIDIA', icon: 'nvidia', color: '#76b900', match: /^(nemotron|nvidia)/i },
  { id: 'Microsoft', name: 'Microsoft', icon: 'microsoft', color: '#00a4ef', match: /^(phi|microsoft|mai-)/i },
  { id: 'Cohere', name: 'Cohere', icon: 'cohere', color: '#39594d', match: /^(command|aya|cohere)/i },
  { id: 'Amazon', name: 'Amazon Nova', icon: 'nova', color: '#ff9900', match: /^(nova|amazon|titan)/i },
  { id: 'Meituan', name: 'Meituan LongCat', cn: '美团', icon: 'longcat', color: '#ffc300', match: /^longcat/i },
  { id: 'Kuaishou', name: 'Kuaishou KAT', cn: '快手', icon: 'kwaikat', color: '#ff4906', match: /^(kat|kwai)/i },
  { id: '01AI', name: '01.AI', cn: '零一万物', icon: 'yi', color: '#133426', match: /^(yi-|01)/i },
  { id: 'Baichuan', name: 'Baichuan', cn: '百川', icon: 'baichuan', color: '#fe5a1d', match: /^baichuan/i },
  { id: 'SenseTime', name: 'SenseNova', cn: '商汤', icon: 'sensenova', color: '#5b3cf5', match: /^(sensenova|sensechat)/i },
  { id: 'iFlytek', name: 'iFlytek Spark', cn: '讯飞星火', icon: 'spark', color: '#0070f0', match: /^spark/i },
  { id: 'InternLM', name: 'InternLM', cn: '书生', icon: 'internlm', color: '#1b3882', match: /^intern/i },
  { id: 'NousResearch', name: 'Nous Research', icon: 'nousresearch', color: '#8b8b8b', match: /^hermes/i },
];

/** 模型系列图标（比供应商图标更贴近模型本身）。 */
const FAMILY_ICONS: [RegExp, string][] = [
  [/^claude/i, 'claude'], [/^gemini/i, 'gemini'], [/^gemma/i, 'gemma'], [/^qwen|^qwq|^qvq/i, 'qwen'], [/^kimi/i, 'kimi'],
  [/^grok/i, 'grok'], [/^doubao|^seed/i, 'doubao'], [/^hunyuan/i, 'hunyuan'], [/^ernie|^wenxin/i, 'wenxin'], [/^glm|^chatglm/i, 'zhipu'],
  [/^nova/i, 'nova'], [/^codex/i, 'codex'], [/^mimo/i, 'xiaomimimo'], [/^deepseek/i, 'deepseek'], [/^minimax|^abab/i, 'minimax'],
];

export const vendorById = (id: string | null | undefined) => VENDORS.find((v) => v.id.toLowerCase() === String(id || '').toLowerCase());

/** 从模型名推断供应商；无法识别返回 null。 */
export function inferVendor(model: string): VendorDef | null {
  const s = model.trim().split('/').pop() || '';
  for (const v of VENDORS) if (v.match.test(s)) return v;
  return null;
}

/** 解析 “供应商/模型” 或只有模型名的输入。 */
export function parseModelInput(raw: string): { vendor: string | null; name: string; inferred: boolean } {
  const s = raw.trim();
  const i = s.indexOf('/');
  if (i > 0) {
    const vp = s.slice(0, i).trim();
    return { vendor: vendorById(vp)?.id || vp, name: s.slice(i + 1).trim(), inferred: false };
  }
  return { vendor: inferVendor(s)?.id || null, name: s, inferred: true };
}

export function iconFor(vendor: string | null | undefined, model?: string | null): string | null {
  if (model) for (const [re, ic] of FAMILY_ICONS) if (re.test(model)) return ic;
  return vendorById(vendor)?.icon || (vendor ? inferVendor(vendor)?.icon || null : null);
}

// ---------------- harness ----------------
export type HarnessKind = 'app' | 'ide' | 'cli';
export interface HarnessDef {
  id: string; name: string; kind: HarnessKind; icon: string | null; vendor?: string;
  /** Windows：相对 %LOCALAPPDATA%\Programs 或 Program Files 的候选目录 + exe 名 */
  win?: { dirs: string[]; exe: RegExp };
  cmd?: string;           // 命令行程序名（where 检测）
  folderArg?: boolean;    // 启动时把工作目录作为参数传入（IDE）
  logs?: string;          // bench-grader 能解析的日志来源名
}

export const HARNESSES: HarnessDef[] = [
  { id: 'deepseek-harness', name: 'DeepSeek Harness', kind: 'app', icon: 'deepseek', win: { dirs: ['DeepSeek Harness'], exe: /^DeepSeek Harness\.exe$/i } },
  { id: 'codex', name: 'Codex CLI', kind: 'cli', icon: 'codex', vendor: 'OpenAI', cmd: 'codex', logs: 'codex' },
  { id: 'claude-code', name: 'Claude Code', kind: 'cli', icon: 'claudecode', vendor: 'Anthropic', cmd: 'claude', logs: 'claude_code' },
  { id: 'gemini-cli', name: 'Gemini CLI', kind: 'cli', icon: 'gemini', vendor: 'Google', cmd: 'gemini', logs: 'gemini_cli' },
  { id: 'kimi-cli', name: 'Kimi CLI', kind: 'cli', icon: 'kimi', vendor: 'Moonshot', cmd: 'kimi' },
  { id: 'opencode', name: 'OpenCode', kind: 'cli', icon: 'opencode', cmd: 'opencode' },
  { id: 'opencode-desktop', name: 'OpenCode Desktop', kind: 'app', icon: 'opencode', win: { dirs: ['@opencode-aidesktop'], exe: /^OpenCode\.exe$/i } },
  { id: 'cline', name: 'Cline CLI', kind: 'cli', icon: 'cline', cmd: 'cline' },
  { id: 'kiro-cli', name: 'Kiro CLI', kind: 'cli', icon: 'kiro', cmd: 'kiro-cli' },
  { id: 'cursor', name: 'Cursor', kind: 'ide', icon: 'cursor', win: { dirs: ['cursor'], exe: /^Cursor\.exe$/i }, folderArg: true },
  { id: 'antigravity', name: 'Antigravity', kind: 'ide', icon: 'antigravity', vendor: 'Google', win: { dirs: ['Antigravity', 'Antigravity IDE'], exe: /^Antigravity( IDE)?\.exe$/i }, folderArg: true },
  { id: 'qoder', name: 'Qoder', kind: 'ide', icon: 'qoder', win: { dirs: ['Qoder', 'Qoder IDE'], exe: /^Qoder( IDE)?\.exe$/i }, folderArg: true },
  { id: 'trae', name: 'TRAE', kind: 'ide', icon: 'trae', vendor: 'ByteDance', win: { dirs: ['Trae', 'Trae CN'], exe: /^Trae( CN)?\.exe$/i }, folderArg: true },
  { id: 'windsurf', name: 'Windsurf', kind: 'ide', icon: 'windsurf', win: { dirs: ['Windsurf'], exe: /^Windsurf\.exe$/i }, folderArg: true },
  { id: 'devin', name: 'Devin', kind: 'app', icon: 'devin', win: { dirs: ['Devin'], exe: /^Devin\.exe$/i } },
  { id: 'hermes', name: 'Hermes Agent', kind: 'app', icon: 'hermesagent', win: { dirs: ['hermes-desktop'], exe: /^hermes-agent\.exe$/i } },
  { id: 'multica', name: 'Multica', kind: 'app', icon: null, win: { dirs: ['@multicadesktop'], exe: /^Multica\.exe$/i } },
  { id: 'catpaw', name: 'CatPaw', kind: 'app', icon: null, win: { dirs: ['CatPawAI'], exe: /^CatPawAI\.exe$/i } },
];

export const harnessById = (id: string | null | undefined) => HARNESSES.find((h) => h.id === id);
/** harness 显示名 → 定义（运行与模型档案里存的是显示名，便于与 bench-grader entrant 一致）。 */
export const harnessByName = (name: string | null | undefined) => {
  const n = String(name || '').trim().toLowerCase();
  return n ? HARNESSES.find((h) => h.name.toLowerCase() === n || h.id === n) : undefined;
};

/** 为模型推荐 harness：全局默认 → 与供应商同源的 → DeepSeek Harness → 其他已安装的。 */
export function suggestHarness(vendor: string | null | undefined, installed: string[], preferred?: string | null): HarnessDef | null {
  const ok = (h?: HarnessDef) => !!h && installed.includes(h.id);
  const pref = harnessById(preferred || '') || harnessByName(preferred || '');
  if (ok(pref)) return pref!;
  const same = HARNESSES.find((h) => h.vendor && h.vendor === vendor && ok(h));
  if (same) return same;
  const ds = harnessById('deepseek-harness');
  if (ok(ds)) return ds!;
  return HARNESSES.find((h) => ok(h)) || null;
}
