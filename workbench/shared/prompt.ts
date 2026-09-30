// 发给被测模型的提示词：按 references/run-protocol.md 的“提示词使用”规则处理 prompt.md 原文。
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
    else warnings.push('提示词含 {TTS_COMMAND} 占位符：请在「系统 → 设置」填写评测机上统一的 TTS 命令后再发送。');
  }
  return { text, warnings };
}
