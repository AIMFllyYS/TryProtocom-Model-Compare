export const SCORE_BANDS = [
  { min: 90, label: '90–100' },
  { min: 80, label: '80–<90' },
  { min: 70, label: '70–<80' },
  { min: 60, label: '60–<70' },
  { min: 0, label: '0–<60' },
] as const;

export function scoreBand(score: number | null | undefined) {
  return score == null || !Number.isFinite(score) ? undefined : SCORE_BANDS.find((band) => score >= band.min)?.min ?? 0;
}
