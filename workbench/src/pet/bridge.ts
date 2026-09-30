// 桌面宠物与 Electron 主进程之间的桥（pet-preload.cjs 注入）。在普通浏览器里打开 pet.html 时为 undefined，所有动作退化为 no-op / 新标签页。
export interface PetBridge {
  setSize(w: number, h: number): void;
  /** 按住宠物开始拖动：主进程按光标绝对位置移动窗口，直到 gestureEnd */
  dragStart(): void;
  /** 拖面板左边 / 上边 / 左上角改尺寸（右下角固定），直到 gestureEnd */
  resizeStart(edge: 'l' | 't' | 'tl', minW: number, minH: number): void;
  /** 结束拖动 / 改尺寸，返回最终窗口尺寸 */
  gestureEnd(): Promise<{ w: number; h: number } | null>;
  capture(): Promise<string | null>;
  open(hash: string): void;
  quit(): void;
}
declare global { interface Window { wbPet?: PetBridge } }
export const bridge: PetBridge | undefined = window.wbPet;

export const open = (hash: string) => { if (bridge) bridge.open(hash); else window.open('/#/' + hash, '_blank'); };

/** 窗口尺寸：宠物球 / 气泡固定；面板和日志页可以拖边调节，调节结果记在本机 */
export const SIZE = { orb: [176, 176], bubble: [364, 272], panel: [384, 590], log: [468, 690] } as const;
export const MIN = { panel: [320, 420], log: [360, 460] } as const;
export type Sized = 'panel' | 'log';
export function loadSize(k: Sized): [number, number] {
  try {
    const v = JSON.parse(localStorage.getItem('pet.size.' + k) || 'null');
    if (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n))) return [Math.max(MIN[k][0], v[0]), Math.max(MIN[k][1], v[1])];
  } catch { /* 坏值：用默认 */ }
  return [SIZE[k][0], SIZE[k][1]];
}
export const saveSize = (k: Sized, s: [number, number] | null) => { if (s) localStorage.setItem('pet.size.' + k, JSON.stringify(s)); else localStorage.removeItem('pet.size.' + k); };
