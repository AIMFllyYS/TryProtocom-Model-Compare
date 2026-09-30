// 品牌头像：模型 / 供应商 / harness 统一用玻璃瓷砖承载真实品牌图标（Lobe Icons，本地打包）。
import type { ReactNode } from 'react';
import { harnessByName, iconFor, MONO_ICONS, vendorById } from '../../shared/vendors';
import { cls, colorFor } from '../lib/format';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export const brandUrl = (icon: string) => `/brands/${icon}.svg`;

export function BrandIcon({ icon, fallback, color, size = 'md', className, dot }: { icon: string | null | undefined; fallback: string; color?: string; size?: Size; className?: string; dot?: string }) {
  if (!icon) {
    const c = color || colorFor(fallback);
    return <span className={cls('avatar lettered', size, className)} style={{ ['--c' as string]: c }} aria-hidden><span className="initial">{fallback.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase() || '?'}</span>{dot && <i className="av-dot" style={{ ['--c' as string]: dot }} />}</span>;
  }
  return (
    <span className={cls('avatar', size, className)} aria-hidden>
      {MONO_ICONS.has(icon) ? <i className="mono-ic" style={{ ['--ic' as string]: `url(${brandUrl(icon)})` }} /> : <img src={brandUrl(icon)} alt="" draggable={false} />}
      {dot && <i className="av-dot" style={{ ['--c' as string]: dot }} />}
    </span>
  );
}

export function ModelAvatar({ vendor, model, size = 'md', blind, dot }: { vendor: string | null | undefined; model: string; size?: Size; blind?: boolean; dot?: string }) {
  if (blind) return <BrandIcon icon={null} fallback="?" color="#8a8fa3" size={size} dot={dot} />;
  return <BrandIcon icon={iconFor(vendor, model)} fallback={model || vendor || '?'} color={vendorById(vendor)?.color} size={size} dot={dot} />;
}

export function HarnessIcon({ name, size = 'sm' }: { name: string | null | undefined; size?: Size }) {
  const h = harnessByName(name || '');
  return <BrandIcon icon={h?.icon || null} fallback={name || '?'} size={size} />;
}

/** 头像 + 名称 + 副标题 */
export function Who({ avatar, title, sub, className }: { avatar: ReactNode; title: ReactNode; sub?: ReactNode; className?: string }) {
  return <span className={cls('who', className)}>{avatar}<span className="who-t"><b>{title}</b>{sub && <span>{sub}</span>}</span></span>;
}

export const vendorColor = (vendor: string | null | undefined, key: string) => vendorById(vendor)?.color || colorFor(key);

/** GitHub 标志（跟随文字颜色） */
export function GithubIcon({ size = 16 }: { size?: number }) {
  return <i aria-hidden style={{ display: 'inline-block', width: size, height: size, background: 'currentColor', WebkitMask: `url(${brandUrl('github')}) center / contain no-repeat`, mask: `url(${brandUrl('github')}) center / contain no-repeat` }} />;
}
