// 费用填写：美元 / 人民币互斥。选人民币时按设置里的汇率（默认 7）折成美元交给上层，
// 后端始终只收美元 —— 换算只发生在这一层，别处不要重复换算。
import { useEffect, useRef, useState } from 'react';
import { useWb } from '../state';
import { Field, Seg } from '../ui/kit';

export const DEFAULT_CNY_RATE = 7;

/** 人民币兑美元汇率：设置页可改，默认 7。 */
export function useCnyRate(): number {
  const wb = useWb();
  const r = Number(wb.store?.settings?.cny_rate);
  return Number.isFinite(r) && r > 0 ? r : DEFAULT_CNY_RATE;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
/** 输入框里的数字：去掉多余的 0，但不丢精度 */
const numText = (v: number) => (Number.isInteger(v) ? String(v) : String(round(v, 4)));

/**
 * 费用输入（美元 / 人民币互斥）。
 * 受控：`usd` 是唯一真值，始终以美元上报；人民币只是显示层，按汇率折算。
 */
export function CostFields({ usd, onChange, hint, disabled }: {
  usd?: number | null;
  onChange: (v: number | undefined) => void;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  const rate = useCnyRate();
  const [cur, setCur] = useState<'usd' | 'cny'>('usd');
  const [txt, setTxt] = useState(usd == null ? '' : numText(usd));
  // 记住自己最后一次上报的值：只有外部把它改成了别的数（例如切换运行、重置）才回写输入框，
  // 否则每次按键都会因为父组件重渲染把正在输入的内容冲掉。
  const emitted = useRef<number | undefined>(usd ?? undefined);
  useEffect(() => {
    if (usd === emitted.current) return;
    emitted.current = usd ?? undefined;
    setTxt(usd == null ? '' : numText(cur === 'cny' ? usd * rate : usd));
  }, [usd, rate, cur]);

  const emit = (next: string, nextCur: 'usd' | 'cny') => {
    setTxt(next);
    if (next.trim() === '') { emitted.current = undefined; onChange(undefined); return; }
    const n = Number(next);
    if (!Number.isFinite(n) || n < 0) return; // 打到一半的输入先不动上层
    const u = nextCur === 'cny' ? round(n / rate, 6) : n;
    emitted.current = u;
    onChange(u);
  };
  const switchTo = (c: 'usd' | 'cny') => {
    if (c === cur) return;
    setCur(c);
    setTxt(usd == null ? '' : numText(c === 'cny' ? usd * rate : usd));
  };

  return (
    <>
      <Field label="费用（美元）" hint={hint}>
        <input type="number" step="0.001" min="0" disabled={disabled || cur === 'cny'}
          value={cur === 'usd' ? txt : usd == null ? '' : numText(usd)}
          onChange={(e) => emit(e.target.value, 'usd')} placeholder="留空按日志 × 单价估算" />
      </Field>
      <Field label={`费用（人民币）`} hint={cur === 'usd' && usd != null ? `按 1 : ${rate} 折算` : undefined}>
        <input type="number" step="0.01" min="0" disabled={disabled || cur === 'usd'}
          value={cur === 'cny' ? txt : usd == null ? '' : numText(round(usd * rate, 4))}
          onChange={(e) => emit(e.target.value, 'cny')} placeholder="填人民币会自动折成美元" />
      </Field>
      <Field label="用哪种货币" hint="两者互斥：填了美元就不能填人民币，反之亦然">
        <Seg size="xs" value={cur} onChange={switchTo} options={[{ value: 'usd', label: '美元' }, { value: 'cny', label: '人民币' }]} />
      </Field>
    </>
  );
}
