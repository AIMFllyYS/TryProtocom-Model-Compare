/** 人工预览 1–10。没有 scale 的旧 0–3 只换算成选中态，不改已落盘的分。 */
export const LEGACY_DISPLAY = [2, 4, 6, 10] as const;
export const LEVEL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

export function displayLevel(score: number | null | undefined, scale?: string | null): number | null {
  if (score == null || Number.isNaN(Number(score))) return null;
  if (scale === 'human-10') return Number(score);
  const i = Math.round(Number(score));
  return i >= 0 && i < LEGACY_DISPLAY.length ? LEGACY_DISPLAY[i] : null;
}

/** 1–2 红，3–4 橙，5–7 紫，8–10 绿。沿用原来的四段颜色。 */
export function levelBand(level: number): 0 | 1 | 2 | 3 {
  if (level <= 2) return 0;
  if (level <= 4) return 1;
  if (level <= 7) return 2;
  return 3;
}
