// 订阅额度 → 费用换算：用开跑前后剩余额度之差 × 单位价格（周期费用 ÷ 周期额度）。
import type { Billing, RunQuota } from './types';

export const QUOTA_UNITS = ['次', '条消息', '点', '%', '美元', 'token'] as const;

export function unitPrice(b?: Billing | null): number | null {
  if (!b || b.mode !== 'subscription' || !b.monthly_fee || !b.monthly_quota) return null;
  return b.monthly_fee / b.monthly_quota;
}

/** 计算已用额度与折算费用；数据不全时返回 null 字段 */
export function settleQuota(q: RunQuota | undefined, b?: Billing | null): { used: number | null; cost_usd: number | null } {
  if (!q || q.before == null || q.after == null) return { used: null, cost_usd: null };
  const used = Math.max(0, q.before - q.after);
  if (q.unit === '美元') return { used, cost_usd: used };
  const p = unitPrice(b);
  return { used, cost_usd: p == null ? null : +(used * p).toFixed(4) };
}
