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
  /** Windows 开始菜单 AppID（Get-StartApps）。商店 / MSIX 应用（Codex、Claude 桌面版…）装在 WindowsApps 里，只能这样检测和启动。 */
  appId?: RegExp;
  /** 开始菜单快捷方式名：从 .lnk 取出真实 exe，IDE 借此带工作目录启动（exe 不在常见目录时）。 */
  lnk?: RegExp;
  /** 用 URL 协议直接在工作目录打开（例如 Codex 桌面版的 codex://threads/new?path=…）。 */
  deepLink?: (dir: string) => string;
  cmd?: string;           // 命令行程序名（where 检测）
  folderArg?: boolean;    // 启动时把工作目录作为参数传入（IDE）
  logs?: string;          // bench-grader 能解析的日志来源名
  note?: string;          // 界面提示（例如“需要在应用里手动打开工作目录”）
}

const MANUAL_DIR = '启动后请在应用里打开工作目录（路径已写在提示词开头）';

// 顺序即推荐优先级：同一供应商有多个时，排在前面的优先（能自动带上工作目录的排前面）。
export const HARNESSES: HarnessDef[] = [
  { id: 'deepseek-harness', name: 'DeepSeek Harness', kind: 'app', icon: 'deepseek', vendor: 'DeepSeek', win: { dirs: ['DeepSeek Harness'], exe: /^DeepSeek Harness\.exe$/i }, appId: /^com\.deepseek\.dsh$/i, note: MANUAL_DIR },
  // ---- OpenAI ----
  { id: 'codex-desktop', name: 'Codex 桌面版', kind: 'app', icon: 'codex', vendor: 'OpenAI', appId: /^OpenAI\.Codex_/i, logs: 'codex',
    deepLink: (dir) => `codex://threads/new?path=${encodeURIComponent(dir)}` },
  { id: 'codex', name: 'Codex CLI', kind: 'cli', icon: 'codex', vendor: 'OpenAI', cmd: 'codex', logs: 'codex' },
  // ---- Anthropic ----
  { id: 'claude-code', name: 'Claude Code', kind: 'cli', icon: 'claudecode', vendor: 'Anthropic', cmd: 'claude', logs: 'claude_code' },
  { id: 'claude-desktop', name: 'Claude 桌面版', kind: 'app', icon: 'claude', vendor: 'Anthropic', appId: /^Claude_/i, logs: 'claude_code', note: MANUAL_DIR },
  // ---- Google ----
  { id: 'antigravity', name: 'Antigravity', kind: 'ide', icon: 'antigravity', vendor: 'Google', win: { dirs: ['Antigravity', 'Antigravity IDE'], exe: /^Antigravity( IDE)?\.exe$/i }, appId: /^Google\.Antigravity(IDE)?$/i, lnk: /^Antigravity( IDE)?$/i, folderArg: true },
  { id: 'antigravity-cli', name: 'Antigravity CLI', kind: 'cli', icon: 'antigravity', vendor: 'Google', cmd: 'agy' },
  { id: 'gemini-cli', name: 'Gemini CLI', kind: 'cli', icon: 'gemini', vendor: 'Google', cmd: 'gemini', logs: 'gemini_cli' },
  // ---- Moonshot ----
  { id: 'kimi-code', name: 'Kimi Code', kind: 'app', icon: 'kimi', vendor: 'Moonshot', appId: /^com\.kimi\.code\.desktop$/i, note: MANUAL_DIR },
  { id: 'kimi-cli', name: 'Kimi CLI', kind: 'cli', icon: 'kimi', vendor: 'Moonshot', cmd: 'kimi' },
  // ---- Zhipu ----
  { id: 'zcode', name: 'ZCode', kind: 'app', icon: 'zai', vendor: 'Zhipu', appId: /^electron\.app\.ZCode$/i, lnk: /^ZCode$/i, note: MANUAL_DIR },
  // ---- Alibaba ----
  { id: 'qwen-code', name: 'Qwen Code', kind: 'cli', icon: 'qwen', vendor: 'Alibaba', cmd: 'qwen' },
  { id: 'qoder', name: 'Qoder', kind: 'ide', icon: 'qoder', win: { dirs: ['Qoder', 'Qoder IDE'], exe: /^Qoder( IDE)?\.exe$/i }, appId: /^AlibabaCloud\.Qoder(CN)?$/i, lnk: /^Qoder( IDE| CN)?$/i, folderArg: true },
  { id: 'qoder-cli', name: 'Qoder CLI', kind: 'cli', icon: 'qoder', cmd: 'qodercli' },
  { id: 'qoderwork', name: 'QoderWork', kind: 'app', icon: 'qoder', appId: /^com\.qoder\.work/i, note: MANUAL_DIR },
  // ---- ByteDance ----
  { id: 'trae-solo', name: 'TRAE SOLO', kind: 'app', icon: 'trae', vendor: 'ByteDance', appId: /^ByteDance\.TraeSolo/i, note: MANUAL_DIR },
  { id: 'trae', name: 'TRAE', kind: 'ide', icon: 'trae', vendor: 'ByteDance', win: { dirs: ['Trae', 'Trae CN'], exe: /^Trae( CN)?\.exe$/i }, appId: /^ByteDance\.Trae(CN)?$/i, lnk: /^Trae(Code)?( CN)?$/i, folderArg: true },
  // ---- xAI ----
  { id: 'grok-build', name: 'Grok Build', kind: 'cli', icon: 'grok', vendor: 'xAI', cmd: 'grok' },
  // ---- Tencent ----
  { id: 'workbuddy', name: 'WorkBuddy', kind: 'app', icon: 'tencent', vendor: 'Tencent', appId: /^WorkBuddy\./i, note: MANUAL_DIR },
  { id: 'codebuddy', name: 'CodeBuddy Code', kind: 'cli', icon: 'tencent', vendor: 'Tencent', cmd: 'codebuddy' },
  // ---- 通用 IDE / 桌面 Agent ----
  { id: 'cursor', name: 'Cursor', kind: 'ide', icon: 'cursor', win: { dirs: ['cursor'], exe: /^Cursor\.exe$/i }, appId: /^Anysphere\.Cursor$/i, lnk: /^Cursor$/i, folderArg: true },
  { id: 'cursor-cli', name: 'Cursor CLI', kind: 'cli', icon: 'cursor', cmd: 'cursor-agent' },
  { id: 'kiro-ide', name: 'Kiro', kind: 'ide', icon: 'kiro', vendor: 'Amazon', win: { dirs: ['Kiro'], exe: /^Kiro\.exe$/i }, appId: /^Kiro$/, lnk: /^Kiro$/i, folderArg: true },
  { id: 'kiro-cli', name: 'Kiro CLI', kind: 'cli', icon: 'kiro', vendor: 'Amazon', cmd: 'kiro-cli' },
  { id: 'vscode', name: 'VS Code', kind: 'ide', icon: 'microsoft', win: { dirs: ['Microsoft VS Code'], exe: /^Code\.exe$/i }, appId: /^Microsoft\.VisualStudioCode$/i, lnk: /^Visual Studio Code$/i, folderArg: true,
    note: '用 Copilot / Codex / Cline 等插件做题' },
  { id: 'copilot-cli', name: 'GitHub Copilot CLI', kind: 'cli', icon: 'githubcopilot', cmd: 'copilot' },
  { id: 'windsurf', name: 'Windsurf', kind: 'ide', icon: 'windsurf', win: { dirs: ['Windsurf'], exe: /^Windsurf\.exe$/i }, folderArg: true },
  { id: 'devin', name: 'Devin', kind: 'app', icon: 'devin', win: { dirs: ['Devin'], exe: /^Devin\.exe$/i }, appId: /^Exafunction\.Windsurf$/i, lnk: /^Devin$/i, folderArg: true },
  { id: 'opencode-desktop', name: 'OpenCode Desktop', kind: 'app', icon: 'opencode', win: { dirs: ['@opencode-aidesktop'], exe: /^OpenCode\.exe$/i }, appId: /^ai\.opencode\.desktop$/i, note: MANUAL_DIR },
  { id: 'opencode', name: 'OpenCode', kind: 'cli', icon: 'opencode', cmd: 'opencode' },
  { id: 'cline-desktop', name: 'Cline 桌面版', kind: 'app', icon: 'cline', appId: /^bot\.cline\.app$/i, note: MANUAL_DIR },
  { id: 'cline', name: 'Cline CLI', kind: 'cli', icon: 'cline', cmd: 'cline' },
  { id: 'kilo', name: 'Kilo CLI', kind: 'cli', icon: null, cmd: 'kilo' },
  { id: 'droid', name: 'Factory Droid', kind: 'cli', icon: null, cmd: 'droid' },
  { id: 'amp', name: 'Amp', kind: 'cli', icon: null, cmd: 'amp' },
  { id: 'pi', name: 'Pi', kind: 'cli', icon: null, cmd: 'pi' },
  { id: 'aider', name: 'Aider', kind: 'cli', icon: null, cmd: 'aider' },
  { id: 'goose', name: 'Goose', kind: 'cli', icon: null, cmd: 'goose' },
  { id: 'crush', name: 'Crush', kind: 'cli', icon: null, cmd: 'crush' },
  { id: 'iflow', name: 'iFlow CLI', kind: 'cli', icon: null, cmd: 'iflow' },
  { id: 'hermes', name: 'Hermes Agent', kind: 'app', icon: 'hermesagent', vendor: 'NousResearch', win: { dirs: ['hermes-desktop'], exe: /^hermes-agent\.exe$/i }, appId: /^com\.nousresearch\.hermes$/i, note: MANUAL_DIR },
  { id: 'multica', name: 'Multica', kind: 'app', icon: null, win: { dirs: ['@multicadesktop'], exe: /^Multica\.exe$/i }, appId: /^ai\.multica\.desktop$/i, note: MANUAL_DIR },
  { id: 'catpaw', name: 'CatPaw', kind: 'app', icon: null, win: { dirs: ['CatPawAI'], exe: /^CatPawAI\.exe$/i }, appId: /^CatPawAI$/i, note: MANUAL_DIR },
];

export const harnessById = (id: string | null | undefined) => HARNESSES.find((h) => h.id === id);

/** harness 启动方式说明（发车坞 / 设置页）。opensDir 来自服务端检测：能否自动带上工作目录。 */
export function harnessHint(kind: HarnessKind, opensDir: boolean | undefined, long = false): string {
  if (kind === 'cli') return long ? '命令行：在工作目录开新终端' : '在工作目录开终端';
  if (opensDir) return long ? `${kind === 'ide' ? 'IDE' : '桌面应用'}：直接打开工作目录` : '直接打开工作目录';
  return long ? `${kind === 'ide' ? 'IDE' : '桌面应用'}：启动后需在应用里选工作目录` : '启动后手动选目录';
}
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
