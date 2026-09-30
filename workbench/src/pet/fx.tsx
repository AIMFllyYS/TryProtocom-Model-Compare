// 桌面宠物的动效：一次性“反应”（挤压回弹、点头、跳起转圈、抖动…）+ 粒子（星星、彩纸、灰尘）+ 相机闪光 + 截图飞入。
// 全部只动 transform / opacity（合成层），一次动效结束就卸载节点；减少动画偏好下只保留状态变化，不放粒子。
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import './fx.css';

export type Reaction = 'boing' | 'land' | 'wink' | 'cheese' | 'gulp' | 'launch' | 'nod' | 'party' | 'shake' | 'bye' | 'peek';
export type BurstKind = 'spark' | 'star' | 'confetti' | 'dust' | 'heart' | 'sweat';
const DUR: Record<Reaction, number> = { boing: 460, land: 620, wink: 700, cheese: 420, gulp: 620, launch: 820, nod: 700, party: 1100, shake: 560, bye: 460, peek: 520 };
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 身体反应的关键帧（作用在 .orb-react 上，变换原点在身体底部，压扁像落在桌面上） */
export const MOTION: Partial<Record<Reaction, [Keyframe[], number, string]>> = {
  boing: [[{ transform: 'scale(1)' }, { transform: 'scale(1.12, .88)', offset: .25 }, { transform: 'scale(.94, 1.07)', offset: .55 }, { transform: 'scale(1.02, .98)', offset: .8 }, { transform: 'scale(1)' }], DUR.boing, 'ease-out'],
  land: [[{ transform: 'translateY(-8px)' }, { transform: 'translateY(3px) scale(1.2, .8)', offset: .22 }, { transform: 'translateY(-4px) scale(.92, 1.09)', offset: .52 }, { transform: 'scale(1.03, .97)', offset: .78 }, { transform: 'none' }], DUR.land, 'cubic-bezier(.3, .7, .4, 1)'],
  wink: [[{ transform: 'none' }, { transform: 'rotate(-7deg) scale(1.04)', offset: .3 }, { transform: 'rotate(-7deg) scale(1.04)', offset: .7 }, { transform: 'none' }], DUR.wink, 'ease-in-out'],
  cheese: [[{ transform: 'none' }, { transform: 'scale(1.08)', offset: .4 }, { transform: 'scale(1.06)' }], DUR.cheese, 'ease-out'],
  gulp: [[{ transform: 'scale(1.06)' }, { transform: 'scale(.84, 1.12)', offset: .3 }, { transform: 'scale(1.16, .9)', offset: .6 }, { transform: 'scale(.98, 1.02)', offset: .85 }, { transform: 'none' }], DUR.gulp, 'ease-out'],
  launch: [[{ transform: 'none' }, { transform: 'translateY(8px) scale(1.12, .88)', offset: .15 }, { transform: 'translateY(-28px) rotate(200deg) scale(.94, 1.06)', offset: .5 }, { transform: 'translateY(-6px) rotate(360deg)', offset: .8 }, { transform: 'rotate(360deg)' }], DUR.launch, 'cubic-bezier(.3, .6, .3, 1)'],
  nod: [[{ transform: 'none' }, { transform: 'translateY(5px) scale(1.04, .96)', offset: .2 }, { transform: 'none', offset: .42 }, { transform: 'translateY(5px) scale(1.04, .96)', offset: .64 }, { transform: 'none' }], DUR.nod, 'ease-in-out'],
  party: [[{ transform: 'none' }, { transform: 'translateY(-16px) rotate(-9deg)', offset: .2 }, { transform: 'scale(1.08, .92)', offset: .38 }, { transform: 'translateY(-12px) rotate(9deg)', offset: .6 }, { transform: 'scale(1.05, .95)', offset: .78 }, { transform: 'none' }], DUR.party, 'ease-in-out'],
  shake: [[{ transform: 'none' }, { transform: 'translateX(-6px) rotate(-6deg)', offset: .2 }, { transform: 'translateX(6px) rotate(6deg)', offset: .4 }, { transform: 'translateX(-4px) rotate(-3deg)', offset: .6 }, { transform: 'translateX(3px) rotate(2deg)', offset: .8 }, { transform: 'none' }], DUR.shake, 'ease-in-out'],
  bye: [[{ transform: 'none', opacity: 1 }, { transform: 'scale(1.1)', opacity: 1, offset: .3 }, { transform: 'scale(.1) rotate(-50deg)', opacity: 0 }], DUR.bye, 'cubic-bezier(.5, 0, .75, .3)'],
  peek: [[{ transform: 'none' }, { transform: 'translateY(-9px) scale(.97, 1.04)', offset: .4 }, { transform: 'scale(1.03, .97)', offset: .75 }, { transform: 'none' }], DUR.peek, 'ease-out'],
};

interface Burst { id: number; kind: BurstKind; parts: CSSProperties[] }
interface Fly { id: number; src: string; style: CSSProperties }
export interface Fx {
  react: { kind: Reaction; id: number } | null;
  bursts: Burst[];
  flash: number;
  fly: Fly | null;
  /** 触发一次反应（同类重复触发会重新开始） */
  kick(kind: Reaction): void;
  burst(kind: BurstKind, n?: number): void;
  camera(): void;
  /** 截图缩略图从 from 矩形飞进宠物球 */
  swallow(src: string, from: DOMRect, to: DOMRect): Promise<void>;
  cancel(): void;
}

const PALETTE = ['#8b7bff', '#ff8fb4', '#ffc56b', '#6fe0c2', '#6fb6ff', '#ff7a6b'];
let seq = 0;
function parts(kind: BurstKind, n: number): CSSProperties[] {
  return Array.from({ length: n }, (_, i) => {
    const r = Math.random();
    // 方向：星星往上喷，灰尘往两侧低处，汗滴从头顶一侧落下，其余一圈
    const a = kind === 'star' ? -70 + r * 140 : kind === 'dust' ? (i % 2 ? 70 + r * 30 : -100 - r * 30) : kind === 'sweat' ? 40 : (360 / n) * i + r * 24;
    const d = kind === 'dust' ? 26 + r * 14 : kind === 'sweat' ? 0 : kind === 'star' ? 30 + r * 20 : 22 + r * 18;
    return {
      ['--a' as string]: `${a}deg`, ['--d' as string]: `${d}px`, ['--c' as string]: PALETTE[(i + Math.floor(r * 6)) % PALETTE.length],
      ['--s' as string]: `${kind === 'confetti' ? 5 + r * 3 : kind === 'dust' ? 7 + r * 5 : 5 + r * 4}px`, ['--r' as string]: `${Math.round(r * 540 - 270)}deg`,
      ['--delay' as string]: `${Math.round(r * 90)}ms`,
    };
  });
}

export function useFx(): Fx {
  const [react, setReact] = useState<Fx['react']>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [flash, setFlash] = useState(0);
  const [fly, setFly] = useState<Fly | null>(null);
  const timers = useRef(new Set<number>());
  const later = useCallback((ms: number, f: () => void) => { const t = window.setTimeout(() => { timers.current.delete(t); f(); }, ms); timers.current.add(t); }, []);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const kick = useCallback((kind: Reaction) => {
    const id = ++seq;
    setReact({ kind, id });
    later(DUR[kind], () => setReact((r) => (r?.id === id ? null : r)));
  }, [later]);
  const burst = useCallback((kind: BurstKind, n = 10) => {
    if (reduced()) return;
    const b = { id: ++seq, kind, parts: parts(kind, kind === 'sweat' ? 1 : n) };
    setBursts((bs) => [...bs.slice(-3), b]);
    later(1300, () => setBursts((bs) => bs.filter((x) => x.id !== b.id)));
  }, [later]);
  const camera = useCallback(() => { const id = ++seq; setFlash(id); later(520, () => setFlash((f) => (f === id ? 0 : f))); }, [later]);
  const swallow = useCallback((src: string, from: DOMRect, to: DOMRect) => new Promise<void>((done) => {
    if (reduced()) { done(); return; }
    const w = Math.min(from.width * 0.72, 300);
    const h = w * 0.62;
    const x = from.left + (from.width - w) / 2, y = from.top + Math.min(90, from.height * 0.2);
    const tx = to.left + to.width / 2 - (x + w / 2), ty = to.top + to.height / 2 - (y + h / 2);
    const id = ++seq;
    setFly({ id, src, style: { left: x, top: y, width: w, height: h, ['--tx' as string]: `${tx}px`, ['--ty' as string]: `${ty}px` } });
    later(980, () => { setFly((f) => (f?.id === id ? null : f)); done(); });
  }), [later]);
  const cancel = useCallback(() => setReact(null), []);
  return { react, bursts, flash, fly, kick, burst, camera, swallow, cancel };
}

/** 粒子层：放在宠物球里（不跟着球的形变走），以球心为原点 */
export function Bursts({ fx }: { fx: Fx }) {
  if (!fx.bursts.length) return null;
  return <div className="fx-layer" aria-hidden>{fx.bursts.map((b) => b.parts.map((s, i) => <i key={`${b.id}-${i}`} className={`fx-p fx-${b.kind}`} style={s} />))}</div>;
}

/** 整窗效果：相机闪光、截图缩略图飞进宠物 */
export function Overlays({ fx }: { fx: Fx }) {
  return (
    <>
      {fx.flash > 0 && <div key={fx.flash} className="fx-flash" aria-hidden />}
      {fx.fly && <div key={fx.fly.id} className="fx-shot" style={fx.fly.style} aria-hidden><img src={fx.fly.src} alt="" /></div>}
    </>
  );
}
