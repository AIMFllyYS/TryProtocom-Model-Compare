import { rasterizeSvg, svgString } from './exporter';
import { download } from './format';
import { makeZip, type ZipEntry } from './zip';
import { SCORE_BANDS } from './boardScores';
import { escapeSvg as esc, loadModelIcons, modelLabelSvg, type ModelImageLabel } from './modelImageLabel';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAD = 28;
const MAX_AREA = 24_000_000;
const SCALE = 3;
const MAX_HEIGHT = 16_000;
type Picture = Awaited<ReturnType<typeof svgString>>;
type Panel = { table: HTMLTableElement; title: string } | { svg: SVGSVGElement; title: string; subtitle?: string };

export function picturePanels(root: ParentNode, fallback: string): Panel[] {
  return [...root.querySelectorAll<HTMLElement>('table, [data-chart]')].flatMap<Panel>((el) => {
    if (el.closest('[data-board-no-export]')) return [];
    if (el instanceof HTMLTableElement) {
      if (![...el.tBodies].some((body) => body.rows.length)) return [];
      const title = el.closest('.card')?.querySelector('.card-t')?.firstChild?.textContent?.trim() || fallback;
      return [{ table: el, title }];
    }
    const svg = el.querySelector('svg');
    return svg instanceof SVGSVGElement ? [{ svg, title: el.dataset.chart || fallback, subtitle: el.dataset.sub }] : [];
  });
}

async function tablePictures(table: HTMLTableElement, title: string | null, { font, bg, text, dim, border }: Record<'font' | 'bg' | 'text' | 'dim' | 'border', string>): Promise<Picture[]> {
  const bounds = table.getBoundingClientRect();
  const context = document.createElement('canvas').getContext('2d')!;
  const heat = table.classList.contains('board-tbl');
  const w = Math.ceil(bounds.width) + 2 * PAD;
  const maxRowsHeight = Math.max(1, Math.floor(Math.min(MAX_AREA / (w * SCALE * SCALE), MAX_HEIGHT / SCALE)) - 175);
  const rows = Array.from(table.rows).map((row) => {
    const head = row.parentElement === table.tHead;
    const cells = Array.from(row.cells).filter((c) => !c.hasAttribute('data-export-skip')).map((cell) => {
      const pos = cell.getBoundingClientRect();
      const style = getComputedStyle(cell);
      const score = cell.hasAttribute('data-board-score');
      const numeric = cell.classList.contains('num');
      const weight = head || score ? 680 : 480;
      const model: ModelImageLabel | undefined = cell.dataset.exportModel ? JSON.parse(cell.dataset.exportModel) : undefined;
      const label = model ? '' : (cell.dataset.exportText ?? cell.textContent ?? '').trim().replace(/\s+/g, ' ');
      const lines: string[] = [];
      context.font = `${weight} 14px ${font}`;
      let start = 0, end = 0;
      while (end < label.length) {
        end++;
        if (end < label.length && context.measureText(label.slice(start, end + 1)).width <= pos.width - 22) continue;
        const space = label.lastIndexOf(' ', end - 1);
        if (end < label.length && space > start) end = space + 1;
        lines.push(label.slice(start, end).trim());
        start = end;
      }
      return { x: Math.round(pos.left - bounds.left) + PAD, w: Math.round(pos.width),
        lines, weight, numeric, centered: score || cell.classList.contains('center'), span: cell.rowSpan, model,
        fill: score ? style.backgroundColor : '', ink: score ? style.color : head ? dim : text };
    });
    return { head, cells, h: Math.max(head ? 37 : cells.some((c) => c.model) ? 42 : 36, 12 + 18 * Math.max(1, ...cells.map((c) => c.lines.length))) };
  });
  const headers = rows.filter((r) => r.head);
  const body = rows.filter((r) => !r.head);
  const pages: (typeof body)[] = [[]];
  let height = headers.reduce((s, r) => s + r.h, 0);
  for (const row of body) {
    if (height + row.h > maxRowsHeight && pages.at(-1)!.length) {
      pages.push([]);
      height = headers.reduce((s, r) => s + r.h, 0);
    }
    pages.at(-1)!.push(row);
    height += row.h;
  }
  const legend = table.closest('.board-export-section')?.querySelector('.board-score-legend');
  const offset = title ? 0 : -34;
  const bands = [...SCORE_BANDS, { min: 'none', label: '— 无数据' }];
  const scale = heat ? `<g transform="translate(0 ${offset})">` + bands.map((band, i) => {
    const swatch = legend?.querySelector(`[data-board-score="${band.min}"]`);
    const css = swatch ? getComputedStyle(swatch) : null;
    const x = PAD + 58 + i * 74;
    return `<rect x="${x}" y="51" width="64" height="19" rx="9" fill="${esc(css?.backgroundColor ?? border)}"/><text x="${x + 32}" y="64.5" text-anchor="middle" fill="${esc(css?.color ?? text)}" font-size="11" font-weight="680">${esc(band.label)}</text>`;
  }).join('') + `<text x="${PAD}" y="64.5" fill="${esc(dim)}" font-size="11">分数段</text></g>` : '';
  const labels = body.flatMap((row) => row.cells.flatMap((cell) => cell.model ? [cell.model] : []));
  const icons = await loadModelIcons(labels, text);
  return pages.map((page, pageIndex) => {
    const all = [...headers, ...page];
    let y = (heat ? 81 : 59) + offset;
    const grid = all.map((row, index) => {
      const start = y;
      y += row.h;
      const stripe = row.head || (index - headers.length) % 2 === 0 ? border : 'none';
      return `<rect x="${PAD}" y="${start}" width="${w - 2 * PAD}" height="${row.h}" fill="${stripe}"/>` + row.cells.map((c) => {
        const cellHeight = all.slice(index, index + c.span).reduce((n, next) => n + next.h, 0);
        if (c.model) return modelLabelSvg(c.model, icons, { font, ink: text, dim, tile: border }, context, c.x + 10, start + cellHeight / 2, c.w - 20);
        const x = c.centered ? c.x + c.w / 2 : c.numeric ? c.x + c.w - 10 : c.x + 10;
        const align = c.centered ? 'middle' : c.numeric ? 'end' : 'start';
        return (c.fill ? `<rect x="${c.x + 2}" y="${start + 2}" width="${Math.max(0, c.w - 4)}" height="${cellHeight - 4}" rx="6" fill="${esc(c.fill)}"/>` : '') +
          `<text x="${x}" y="${start + cellHeight / 2 - (c.lines.length - 1) * 9 + 5}" text-anchor="${align}" fill="${esc(c.ink)}" font-weight="${c.weight}">` +
          c.lines.map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : 18}">${esc(line)}</tspan>`).join('') + '</text>';
      }).join('');
    }).join('');
    const h = y + 16;
    const heading = title && title + (pages.length > 1 ? ` · ${pageIndex + 1}/${pages.length}` : '');
    return { w, h, text: `<svg xmlns="${SVG_NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" rx="18" fill="${esc(bg)}"/><g font-family="${esc(font)}" font-size="14">${heading ? `<text x="${PAD}" y="37" fill="${esc(text)}" font-size="21" font-weight="730">${esc(heading)}</text>` : ''}${scale}${grid}</g></svg>` };
  });
}

export async function saveBoardImage(panels: Panel[], title: string, scope: string): Promise<void> {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string) => root.getPropertyValue(name).trim();
  const theme = { bg: token('--bg'), text: token('--text'), dim: token('--text-2'), border: token('--fill-2'), font: token('--font') };
  const pictures = (await Promise.all(panels.map(async (p) => 'table' in p ? tablePictures(p.table, p.title === title ? null : p.title, theme)
    : [await svgString(p.svg, { title: p.title, subtitle: p.subtitle, footer: false, pad: 24 })]))).flat();
  const w = Math.ceil(Math.max(480, ...pictures.map((p) => p.w)) + 2 * PAD);
  const pages: Picture[][] = [[]];
  let y = 115;
  for (const p of pictures) {
    if ((w * (y + p.h) * SCALE ** 2 > MAX_AREA || (y + p.h) * SCALE > MAX_HEIGHT) && pages.at(-1)!.length) {
      pages.push([]);
      y = 115;
    }
    pages.at(-1)!.push(p);
    y += p.h + 12;
  }
  const name = title.replace(/[\\/:*?"<>|]+/g, '-');
  const entries: ZipEntry[] = [];
  for (const [i, page] of pages.entries()) {
    let top = 84;
    const body = page.map((p) => {
      const s = p.text.replace('<svg ', `<svg x="${(w - p.w) / 2}" y="${top}" `);
      top += p.h + 12;
      return s;
    }).join('');
    const h = Math.ceil(top + 26);
    const suffix = pages.length > 1 ? ` · ${i + 1}/${pages.length}` : '';
    const text = `<svg xmlns="${SVG_NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${esc(theme.bg)}"/><g font-family="${esc(theme.font)}"><text x="${PAD}" y="38" fill="${esc(theme.text)}" font-size="23" font-weight="740">${esc(title + suffix)}</text><text x="${PAD}" y="61" fill="${esc(theme.dim)}" font-size="13">${esc(scope)}</text>${body}<text x="${w - PAD}" y="${h - 13}" text-anchor="end" fill="${esc(theme.dim)}" font-size="11">Model Compare · Bench Workbench</text></g></svg>`;
    const scale = Math.min(SCALE, Math.sqrt(MAX_AREA / (w * h)), MAX_HEIGHT / Math.max(w, h));
    const png = await rasterizeSvg({ text, w, h }, scale);
    if (pages.length === 1) { download(name + '.png', png); return; }
    entries.push({ name: `${name}-${String(i + 1).padStart(2, '0')}.png`, data: new Uint8Array(await png.arrayBuffer()) });
  }
  download(name + '.zip', makeZip(entries));
}
