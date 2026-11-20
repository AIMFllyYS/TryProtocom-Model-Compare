import { iconFor, inferVendor, MONO_ICONS } from '../../shared/vendors';

export interface ModelImageLabel {
  name: string;
  effort?: string;
  harness?: string;
  icon?: string | null;
  color?: string;
  blind?: boolean;
}

/** Recognize explicit effort suffixes. Product names such as Qwen Max and GPT Sol stay intact. */
export function splitModelEffort(raw: string): Pick<ModelImageLabel, 'name' | 'effort'> {
  const name = raw.trim();
  const match = /^(.+?)\s+(?:\((minimal|low|medium|high|xx?[- ]?high|extra[- ]high)\)|(minimal|low|medium|high|xx?[- ]?high|extra[- ]high))(\s+\d{4})?$/i.exec(name);
  if (!match) return { name };
  const effort = (match[2] || match[3]).toLowerCase().replace(/[- ]/g, '').replace(/^extrahigh$/, 'xhigh');
  return { name: match[1] + (match[4] || ''), effort };
}

export function modelImageLabel(row: { model: string; vendor?: string | null; harness?: string }, alias?: string, color?: string): ModelImageLabel {
  if (alias) return { name: alias, color, blind: true };
  return { ...splitModelEffort(row.model), harness: row.harness, icon: iconFor(row.vendor || inferVendor(row.model)?.id, row.model), color };
}

export const escapeSvg = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));

const brandAssets = new Map<string, Promise<string | null>>();
type Icons = Map<string, string>;
export async function loadModelIcons(labels: ModelImageLabel[], ink: string): Promise<Icons> {
  const names = new Set(labels.map((label) => label.blind ? null : label.icon));
  const entries = await Promise.all([...names].flatMap((name) => {
    if (!name || !/^[a-z0-9-]+$/.test(name)) return [];
    const pending = brandAssets.get(name) ?? fetch(`/brands/${name}.svg`).then(async (r) => {
      const text = r.ok ? await r.text() : '';
      return text.trimStart().startsWith('<svg') ? text : null;
    }).catch(() => null);
    brandAssets.set(name, pending);
    return [pending.then((text) => {
      if (!text) { brandAssets.delete(name); return null; }
      const img = MONO_ICONS.has(name) ? text.replace(/currentColor/g, ink) : text;
      return [name, 'data:image/svg+xml,' + encodeURIComponent(img)] as const;
    })];
  }));
  return new Map(entries.filter((entry) => entry !== null));
}

type LabelTheme = { font: string; ink: string; dim: string; tile: string };
export function modelLabelSvg(label: ModelImageLabel, icons: Icons, theme: LabelTheme, context: CanvasRenderingContext2D, x: number, y: number, width: number) {
  const src = !label.blind && label.icon && icons.get(label.icon);
  const bg = escapeSvg(theme.tile);
  const fg = escapeSvg(theme.ink);
  const dim = escapeSvg(theme.dim);
  const effort = label.effort ? ` (${label.effort})` : '';
  const available = Math.max(22, width - 32);
  const clip = (value: string, font: string, limit: number) => {
    context.font = `${font} ${theme.font}`;
    if (context.measureText(value).width <= limit) return value;
    const chars = Array.from(value);
    while (chars.length && context.measureText(chars.join('') + '…').width > limit) chars.pop();
    return chars.join('') + '…';
  };
  context.font = `500 11px ${theme.font}`;
  const effortWidth = context.measureText(effort).width;
  const name = clip(label.name, '700 14px', available - effortWidth);
  const harness = label.harness ? clip(`@ ${label.harness}`, '500 11px', available) : '';
  const mainY = harness ? y - 2 : y + 4;
  const letter = label.blind ? '?' : Array.from(label.name.match(/[\p{L}\p{N}]/u)?.[0] || '?')[0].toUpperCase();
  return `<g data-model-label="true"><rect x="${x}" y="${y - 11}" width="22" height="22" rx="6" fill="${bg}"/>`
    + (src ? `<image x="${x + 3}" y="${y - 8}" width="16" height="16" href="${escapeSvg(src)}"/>`
      : `<text x="${x + 11}" y="${y + 4}" text-anchor="middle" fill="${dim}" font-size="12" font-weight="700">${escapeSvg(letter)}</text>`)
    + `<text x="${x + 29}" y="${mainY}" fill="${fg}" font-size="14" font-weight="700">${escapeSvg(name)}`
    + (effort ? `<tspan dx="3" fill="${dim}" font-weight="500" font-size="11">${escapeSvg(effort.trim())}</tspan>` : '')
    + `</text>` + (harness ? `<text x="${x + 29}" y="${y + 12}" fill="${dim}" font-size="11">${escapeSvg(harness)}</text>` : '')
    + (label.color ? `<circle cx="${x + 20}" cy="${y + 9}" r="3" fill="${escapeSvg(label.color)}"/>` : '')
    + '</g>';
}
