// 提示词：
//  1. 发给被测模型的提示词 = 统一「运行约定」头 + prompt.md 原文（按 references/run-protocol.md 处理 A/C 段、T06 分隔线、TTS 占位符）
//  2. 发给评分 Agent 的「AI 评审提示词」（配合 .agents/skills 下的 bench-workbench + bench-grader）
import { deliverableFor, FINAL_FILE } from './deliverables';

export interface PromptResult { text: string; warnings: string[] }

export function buildPrompt(raw: string, taskId: string, variant: string | null, opts: { tts?: string } = {}): PromptResult {
  const warnings: string[] = [];
  let text = raw.replace(/\r\n/g, '\n');
  // 有人值守题：只发分隔线以下部分（T06）
  const sep = text.split('\n').findIndex((l) => /^-{3,}\s*$/.test(l.trim()));
  if (taskId === 'T06' && sep >= 0) text = text.split('\n').slice(sep + 1).join('\n').trim() + '\n';
  // A/C 对照：删去另一组的条件段
  if (variant) {
    const other = variant === 'A' ? 'C' : 'A';
    text = text.split('\n').filter((l) => !l.trim().startsWith(`【${other} 组】`) && !l.trim().startsWith(`【${other}组】`)).join('\n');
  }
  if (text.includes('{TTS_COMMAND}')) {
    if (opts.tts) text = text.split('{TTS_COMMAND}').join(opts.tts);
    else warnings.push('提示词含 {TTS_COMMAND} 占位符：请在「设置」填写评测机上统一的 TTS 命令后再发送。');
  }
  return { text, warnings };
}

export interface RunHeaderInput {
  bench: string; taskId: string; taskName: string; variant: string | null; runIndex: number | null;
  workspace: string | null;           // 绝对路径；null 表示尚未创建（只在题目页预览时出现）
  deliverableDir: string; timeLimit: number | null; materials: string[]; condition?: string;
}

/** 统一运行约定：把“在哪里做、交什么、叫什么名字、怎么结束”说清楚，工作台据此自动检测交付。 */
export function runHeader(h: RunHeaderInput): string {
  const d = deliverableFor(h.taskId, h.deliverableDir);
  const dir = d.dir || h.deliverableDir;
  const tag = `${h.taskId}${h.variant || ''}`;
  const L: string[] = [];
  L.push(`# 运行约定（${h.bench} · ${tag}${h.runIndex ? ` · 第 ${h.runIndex} 次运行` : ''}）`);
  L.push('');
  L.push('开始前请完整阅读本节，它与下面的题目原文同等重要。');
  L.push('');
  L.push(`1. **工作目录**：${h.workspace ? `\`${h.workspace}\`` : '（复制时由工作台创建并填入绝对路径）'}。只在这个目录里创建和修改文件，不要读取或改动目录之外的任何内容。`);
  if (d.kind === 'repo') L.push(`2. **交付位置**：直接修改工作目录中已有的 \`${dir}/\`（不要新建副本，不要重写整个项目）。`);
  else L.push(`2. **交付文件夹**：在工作目录下新建 \`${dir}/\`，名称必须完全一致（区分大小写，不要加前缀或版本号）。`);
  const req = d.files.filter((f) => !f.optional);
  const opt = d.files.filter((f) => f.optional);
  if (req.length) {
    L.push('3. **完成时必须存在**：');
    for (const f of req) L.push(`   - \`${dir}/${f.any ? '' : f.path}${f.dir ? '/' : ''}\`${f.any ? f.label || '' : f.label && f.label !== f.path ? ` —— ${f.label}` : ''}`);
    for (const f of opt) L.push(`   - （可选）${f.label || f.path}`);
  }
  L.push(`4. **结束方式**：全部完成后，把你给我的最后一条总结的原文，同时保存为工作目录下的 \`${FINAL_FILE}\`（与回复内容一致，只写真实存在的文件）。这个文件出现即视为本次运行结束。`);
  if (h.timeLimit) L.push(`5. **时间上限**：${h.timeLimit} 分钟。`);
  if (h.materials.length) L.push(`${h.timeLimit ? 6 : 5}. **预置素材**：已放在工作目录中（${h.materials.map((m) => m.replace(/^materials\//, '')).join('；')}），直接使用，不要重新下载或改名。`);
  L.push('');
  L.push('---');
  L.push('');
  return L.join('\n');
}

export function buildRunPrompt(raw: string, h: RunHeaderInput, opts: { tts?: string; header?: boolean } = {}): PromptResult {
  const body = buildPrompt(raw, h.taskId, h.variant, opts);
  if (opts.header === false) return body;
  return { text: runHeader(h) + body.text.replace(/^\s+/, ''), warnings: body.warnings };
}

export interface ReviewPromptInput {
  root: string;                 // 仓库根目录绝对路径
  bench: string;
  scope: { run_id?: string | null; ref?: string | null; task?: string | null; taskName?: string | null } | 'all';
  pendingAgent?: number;
}

/** 发给评分 Agent 的提示词：先读 skills，再用 wb CLI 完成 Agent 审查项。 */
export function reviewPrompt(p: ReviewPromptInput): string {
  const sep = p.root.includes('\\') ? '\\' : '/';
  const abs = (...x: string[]) => [p.root, ...x].join(sep);
  const s = p.scope;
  const one = s !== 'all';
  const rid = one ? s.run_id : null;
  const target = one ? `运行 \`${rid || s.ref}\`（${s.task || ''}${s.taskName ? ' ' + s.taskName : ''}）` : `所有待评的 Agent 审查项${p.pendingAgent != null ? `（当前 ${p.pendingAgent} 项）` : ''}`;
  const L: string[] = [];
  L.push(`# 任务：为 ${p.bench} 的${target}完成 Agent 审查评分`);
  L.push('');
  L.push('你是**评分方**，不是被测模型。只给 Agent 审查项打分，每一分都必须有证据。');
  L.push('');
  L.push('## 1. 先读 skills（按顺序）');
  L.push('- `.agents/skills/bench-workbench/SKILL.md` —— 工作台 CLI（wb）用法');
  L.push('- `.agents/skills/bench-grader/SKILL.md` —— 评分口径与不可违反的规则');
  L.push('');
  L.push('如果上面的相对路径不存在，改用绝对路径：');
  L.push(`- \`${abs('skills', 'bench-workbench', 'SKILL.md')}\``);
  L.push(`- \`${abs('skills', 'bench-grader', 'SKILL.md')}\``);
  L.push('');
  L.push('## 2. 工作位置');
  L.push(`在仓库根目录 \`${p.root}\` 执行命令（Windows 用 \`wb.cmd\`，其他系统用 \`./wb\`）。所有命令加 \`--json\` 并解析输出。`);
  L.push('');
  L.push('## 3. 步骤');
  L.push('1. `wb status --json`：确认服务可用（未启动会自动后台启动）。');
  let n = 2;
  if (one && !rid && s.ref) {
    L.push(`${n++}. 该运行尚未登记：\`wb run register ${s.ref} --json\`，再用 \`wb job <任务id> --wait --json\` 等待登记与自动评分完成，从输出取得 run_id。`);
  }
  const R = rid || '<run_id>';
  if (one) L.push(`${n++}. \`wb show ${R} --json\`：查看门槛、自动评分与探针备注。若是评测环境问题（缺 ffmpeg / Chromium / npm）导致的缺失，先在汇报中指出，不要接受 0 分。`);
  L.push(`${n++}. \`wb pending --method agent${one && s.task ? ` --task ${s.task}` : ''} --json\`${one ? `：只处理 run_id = ${R} 的项` : '：逐个运行处理'}。每项给出描述、依据、0–3 锚点和产出目录（open 字段）。`);
  L.push(`${n++}. 逐项阅读产出中的代码与文档；需要看页面效果时用 \`wb check <ref> --json\`（移动端加 \`--mobile --viewport 390x844\`）获取控制台报错、失败请求与截图，作为证据。`);
  L.push(`${n++}. 按锚点打分：\`wb score ${R} <item_id> <0-3> --note "文件:行号 或 可复现现象" --by agent\`。`);
  L.push(`${n++}. 看不到证据的项保持待评，不要猜分；人工项（method=human）不要打分，留给用户在工作台评分面板完成。`);
  L.push('');
  L.push('## 4. 规则');
  L.push('- `skills/bench-grader/tasks/*/hidden/` 只能用于核对，绝不复制到任何被测工作目录或对话里。');
  L.push('- 不修改被测产出；不重新运行被测模型。');
  L.push('');
  L.push('## 5. 完成后汇报');
  L.push('列出：打分的 item_id、分数与证据摘要；仍待人工的项数；N/A 或低可信的原因；工作台中查看结果的位置（运行 → 该 ref）。');
  return L.join('\n') + '\n';
}
