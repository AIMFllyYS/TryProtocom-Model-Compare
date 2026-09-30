// 图表导出：把页面里的 SVG（样式来自 CSS 变量与类）内联成独立 SVG，再光栅化为 PNG；支持复制到剪贴板与批量打包。
import { makeZip, type ZipEntry } from './zip';
import { download } from './format';

const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity',
  'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'paint-order', 'visibility', 'display'] as const;

function inline(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  let s = '';
  for (const p of PROPS) { const v = cs.getPropertyValue(p); if (v) s += `${p}:${v};`; }
  (dst as SVGElement).setAttribute('style', s);
  // 解析 fill/stroke 属性里的 var(--x)
  for (const a of ['fill', 'stroke']) {
    const v = dst.getAttribute(a);
    if (v && v.includes('var(')) dst.setAttribute(a, cs.getPropertyValue(a));
  }
  for (let i = 0; i < src.children.length; i++) inline(src.children[i], dst.children[i]);
}

export interface ExportOpts { title?: string; subtitle?: string; bg?: string; scale?: number; pad?: number }

/** 生成独立 SVG 字符串（带标题与背景） */
export function svgString(svg: SVGSVGElement, o: ExportOpts = {}): { text: string; w: number; h: number } {
  const vb = svg.viewBox.baseVal;
  const w0 = vb && vb.width ? vb.width : svg.clientWidth || 600;
  const h0 = vb && vb.height ? vb.height : svg.clientHeight || 400;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inline(svg, clone);
  const root = getComputedStyle(document.documentElement);
  const bg = o.bg ?? (root.getPropertyValue('--bg').trim() || '#fff');
  const text = root.getPropertyValue('--text').trim() || '#111';
  const sub = root.getPropertyValue('--text-3').trim() || '#666';
  const font = root.getPropertyValue('--font').trim();
  const pad = o.pad ?? 28;
  const head = o.title ? (o.subtitle ? 58 : 38) : 0;
  const W = w0 + pad * 2, H = h0 + pad * 2 + head;
  clone.setAttribute('x', String(pad));
  clone.setAttribute('y', String(pad + head));
  clone.setAttribute('width', String(w0));
  clone.setAttribute('height', String(h0));
  clone.removeAttribute('style');
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="100%" height="100%" rx="24" fill="${bg}"/>`
    + (o.title ? `<text x="${pad}" y="${pad + 16}" font-family='${esc(font)}' font-size="18" font-weight="700" fill="${text}">${esc(o.title)}</text>` : '')
    + (o.subtitle ? `<text x="${pad}" y="${pad + 38}" font-family='${esc(font)}' font-size="12.5" fill="${sub}">${esc(o.subtitle)}</text>` : '')
    + new XMLSerializer().serializeToString(clone)
    + `<text x="${W - pad}" y="${H - 10}" text-anchor="end" font-family='${esc(font)}' font-size="10.5" fill="${sub}">TryProtocom Model-Compare · Bench Workbench</text>`
    + '</svg>';
  return { text: out, w: W, h: H };
}

export async function svgToPng(svg: SVGSVGElement, o: ExportOpts = {}): Promise<Blob> {
  const { text, w, h } = svgString(svg, o);
  const scale = o.scale ?? 2;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('SVG 渲染失败')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG 编码失败'))), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'chart';

export async function exportChart(svg: SVGSVGElement, kind: 'png' | 'svg' | 'copy', o: ExportOpts = {}) {
  const name = safe(o.title || 'chart');
  if (kind === 'svg') { download(name + '.svg', svgString(svg, o).text, 'image/svg+xml'); return; }
  const png = await svgToPng(svg, o);
  if (kind === 'png') { download(name + '.png', png); return; }
  if (!('ClipboardItem' in window)) throw new Error('浏览器不支持复制图片');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

/** 打包容器内所有 [data-chart] 图表（PNG + SVG） */
export async function exportAllCharts(root: ParentNode, zipName: string, formats: ('png' | 'svg')[] = ['png', 'svg']): Promise<number> {
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-chart]')];
  const entries: ZipEntry[] = [];
  const used = new Set<string>();
  for (const el of nodes) {
    const svg = el.querySelector('svg');
    if (!svg) continue;
    const title = el.dataset.chart || 'chart';
    let base = safe(title), i = 2;
    while (used.has(base)) base = `${safe(title)}-${i++}`;
    used.add(base);
    const o = { title, subtitle: el.dataset.sub };
    if (formats.includes('svg')) entries.push({ name: `svg/${base}.svg`, data: svgString(svg, o).text });
    if (formats.includes('png')) entries.push({ name: `png/${base}.png`, data: new Uint8Array(await (await svgToPng(svg, o)).arrayBuffer()) });
  }
  if (!entries.length) return 0;
  download(zipName, makeZip(entries));
  return nodes.length;
}
