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
type ImageLook = {
  bg: string; paper: string; header: string; stripe: string; muted: string; divider: string;
  ink: string; dim: string; accent: string; highlight: string;
};
const efficiencyLooks: Record<'time' | 'cost', ImageLook> = {
  time: { bg: '#e8f0f9', paper: '#f8fbff', header: '#dbe8f6', stripe: '#eef5fc', muted: '#f1f3f5', divider: '#e1e7ee',
    ink: '#152941', dim: '#465c73', accent: '#1d517c', highlight: '#dcecfb' },
  cost: { bg: '#f6eee4', paper: '#fffaf3', header: '#f0e3d1', stripe: '#faf2e7', muted: '#f4f2ee', divider: '#eae4dc',
    ink: '#362b22', dim: '#67594c', accent: '#80542b', highlight: '#f5e2c7' },
};

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

async function tablePictures(table: HTMLTableElement, title: string | null, { font, bg, text, dim, border }: Record<'font' | 'bg' | 'text' | 'dim' | 'border', string>, look?: ImageLook): Promise<Picture[]> {
  const bounds = table.getBoundingClientRect();
  const context = document.createElement('canvas').getContext('2d')!;
  const heat = table.classList.contains('board-tbl');
  const centerNumbers = heat || !!look;
  const widths: number[] = [];
  const occupiedUntil: number[] = [];
  const centeredColumns = new Set<number>();
  const source = Array.from(table.rows).map((row, index) => {
    const head = row.parentElement === table.tHead;
    const kind = row.dataset.exportRow;
    const remaining = (row.parentElement as HTMLTableSectionElement | null)?.rows?.length ?? 1;
    let column = 0;
    const cells = Array.from(row.cells).filter((c) => !c.hasAttribute('data-export-skip')).map((cell) => {
      while (occupiedUntil[column] > index) column++;
      const from = column;
      const to = from + cell.colSpan;
      const span = Math.min(cell.rowSpan || remaining, remaining - row.sectionRowIndex);
      for (; column < to; column++) {
        occupiedUntil[column] = index + span;
        widths[column] ??= 0;
      }
      const pos = cell.getBoundingClientRect();
      if (cell.colSpan === 1) {
        const measured = Math.ceil(pos.right - bounds.left) - Math.ceil(pos.left - bounds.left);
        widths[from] = Math.max(widths[from], measured);
      }
      const style = getComputedStyle(cell);
      const score = cell.hasAttribute('data-board-score');
      const primary = cell.dataset.exportEmphasis === 'primary';
      const secondary = cell.dataset.exportEmphasis === 'secondary';
      const nowrap = head || score || primary || secondary || cell.hasAttribute('data-export-nowrap');
      const numeric = cell.classList.contains('num') || cell.hasAttribute('data-export-number');
      const centered = score || cell.classList.contains('center') || (centerNumbers && numeric);
      if (centered && cell.colSpan === 1) centeredColumns.add(from);
      const weight = head || score || primary || kind === 'separator' ? 680 : 480;
      const model: ModelImageLabel | undefined = cell.dataset.exportModel ? JSON.parse(cell.dataset.exportModel) : undefined;
      const label = model ? '' : (cell.dataset.exportText ?? cell.textContent ?? '').trim().replace(/\s+/g, ' ');
      context.font = `${weight} 14px ${font}`;
      const minWidth = (nowrap || kind === 'separator') && label ? Math.ceil(context.measureText(label).width) + 22 : 0;
      const fill = score ? style.backgroundColor : !head && primary ? look?.highlight ?? '' : '';
      const ink = score ? style.color : primary ? look?.accent ?? text : head || secondary || kind === 'separator' ? dim : text;
      return { from, to, minWidth, label, weight, numeric, nowrap: nowrap || kind === 'separator',
        centered, span, model, fill, ink };
    });
    return { head, cells, kind };
  });
  // Fit the complete header before laying out rows. A grouped header can widen all of its columns.
  const fitted = source.flatMap((row) => row.cells).filter((cell) => cell.minWidth > 0);
  for (const cell of fitted.filter((c) => c.to === c.from + 1)) {
    widths[cell.from] = Math.max(widths[cell.from], cell.minWidth);
  }
  for (const cell of fitted.filter((c) => c.to > c.from + 1)) {
    const width = widths.slice(cell.from, cell.to).reduce((sum, w) => sum + w, 0);
    const share = Math.max(0, cell.minWidth - width) / (cell.to - cell.from);
    for (let i = cell.from; i < cell.to; i++) {
      widths[i] += Math.round((i + 1 - cell.from) * share) - Math.round((i - cell.from) * share);
    }
  }
  const edges = [PAD];
  for (const width of widths) edges.push(edges.at(-1)! + width);
  const w = edges.at(-1)! + PAD;
  const offset = title ? 0 : -34;
  const rowsTop = (heat ? 81 : 59) + offset;
  const canvasWidth = Math.max(480, w) + 2 * PAD;
  // Leave room for the panel's bottom padding and the outer title and footer.
  const maxRowsHeight = Math.max(1, Math.floor(Math.min(MAX_AREA / (canvasWidth * SCALE ** 2), MAX_HEIGHT / SCALE)) - rowsTop - 138);
  const rows = source.map(({ head, cells, kind }) => {
    const layout = cells.map((cell) => {
      const { label, weight } = cell;
      const x = edges[cell.from];
      const width = edges[cell.to] - x;
      const centered = cell.centered || (head && cell.to === cell.from + 1 && centeredColumns.has(cell.from));
      if (cell.nowrap) return { ...cell, x, w: width, centered, lines: label ? [label] : [] };
      const lines: string[] = [];
      context.font = `${weight} 14px ${font}`;
      let start = 0, end = 0;
      while (end < label.length) {
        end++;
        if (end < label.length && context.measureText(label.slice(start, end + 1)).width <= width - 22) continue;
        const space = label.lastIndexOf(' ', end - 1);
        if (end < label.length && space > start) end = space + 1;
        lines.push(label.slice(start, end).trim());
        start = end;
      }
      return { ...cell, x, w: width, centered, lines };
    });
    return { head, kind, cells: layout, h: Math.max(head ? 37 : layout.some((c) => c.model) ? 42 : 36, 12 + 18 * Math.max(1, ...layout.map((c) => c.lines.length))) };
  });
  const headers = rows.filter((r) => r.head);
  const body = rows.filter((r) => !r.head);
  const pages: (typeof body)[] = [[]];
  let height = headers.reduce((s, r) => s + r.h, 0);
  for (const row of body) {
    if (!look && height + row.h > maxRowsHeight && pages.at(-1)!.length) {
      pages.push([]);
      height = headers.reduce((s, r) => s + r.h, 0);
    }
    pages.at(-1)!.push(row);
    height += row.h;
  }
  const legend = table.closest('.board-export-section')?.querySelector('.board-score-legend');
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
    let y = rowsTop;
    const grid = all.map((row, index) => {
      const start = y;
      y += row.h;
      const alternate = (index - headers.length) % 2 === 0;
      const stripe = look ? row.head ? look.header : row.kind === 'separator' ? look.divider :
        row.kind === 'unranked' ? (alternate ? look.muted : 'none') : alternate ? look.stripe : 'none'
        : row.head || alternate ? border : 'none';
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
    return { w, h, text: `<svg xmlns="${SVG_NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" rx="18" fill="${esc(look?.paper ?? bg)}"/><g font-family="${esc(font)}" font-size="14">${heading ? `<text x="${PAD}" y="37" fill="${esc(text)}" font-size="21" font-weight="730">${esc(heading)}</text>` : ''}${scale}${grid}</g></svg>` };
  });
}

async function renderBoardImages(panels: Panel[], title: string, scope: string, appearance?: { look: ImageLook; exchange: string }) {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string) => root.getPropertyValue(name).trim();
  const look = appearance?.look;
  const theme = { bg: look?.bg ?? token('--bg'), text: look?.ink ?? token('--text'), dim: look?.dim ?? token('--text-2'),
    border: look?.header ?? token('--fill-2'), font: token('--font') };
  const pictures = (await Promise.all(panels.map(async (p) => 'table' in p ? tablePictures(p.table, p.title === title ? null : p.title, theme, look)
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
  const images: { name: string; png: Blob }[] = [];
  for (const [i, page] of pages.entries()) {
    let top = 84;
    const body = page.map((p) => {
      const s = p.text.replace('<svg ', `<svg x="${(w - p.w) / 2}" y="${top}" `);
      top += p.h + 12;
      return s;
    }).join('');
    const h = Math.ceil(top + 26);
    const suffix = pages.length > 1 ? ` · ${i + 1}/${pages.length}` : '';
    const badge = appearance && `<rect x="${w - PAD - 196}" y="20" width="196" height="27" rx="13.5" fill="${appearance.look.header}"/><text x="${w - PAD - 98}" y="38" text-anchor="middle" fill="${appearance.look.accent}" font-size="12" font-weight="650">${esc(appearance.exchange)}</text>`;
    const text = `<svg xmlns="${SVG_NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${esc(theme.bg)}"/><g font-family="${esc(theme.font)}"><text x="${PAD}" y="38" fill="${esc(theme.text)}" font-size="23" font-weight="740">${esc(title + suffix)}</text><text x="${PAD}" y="61" fill="${esc(theme.dim)}" font-size="13">${esc(scope)}</text>${badge || ''}${body}<text x="${w - PAD}" y="${h - 13}" text-anchor="end" fill="${esc(theme.dim)}" font-size="11">Model Compare · Bench Workbench</text></g></svg>`;
    const scale = Math.min(SCALE, Math.sqrt(MAX_AREA / (w * h)), MAX_HEIGHT / Math.max(w, h));
    const png = await rasterizeSvg({ text, w, h }, scale);
    images.push({ name: pages.length === 1 ? name + '.png' : `${name}-${String(i + 1).padStart(2, '0')}.png`, png });
  }
  return images;
}

async function saveImageZip(title: string, images: Awaited<ReturnType<typeof renderBoardImages>>) {
  const entries: ZipEntry[] = await Promise.all(images.map(async ({ name, png }) => ({ name, data: new Uint8Array(await png.arrayBuffer()) })));
  download(title.replace(/[\\/:*?"<>|]+/g, '-') + '.zip', makeZip(entries));
}

export async function saveBoardImage(panels: Panel[], title: string, scope: string): Promise<void> {
  const images = await renderBoardImages(panels, title, scope);
  if (images.length === 1) download(images[0].name, images[0].png);
  else await saveImageZip(title, images);
}

export async function saveEfficiencyImages(root: ParentNode, title: string, scope: string, rate: number): Promise<void> {
  const images = [];
  for (const mode of ['time', 'cost'] as const) {
    const table = root.querySelector<HTMLTableElement>(`table[data-eff-export="${mode}"]`);
    if (!table?.tBodies[0]?.rows.length) throw new Error('所选模型没有可导出的参赛记录');
    const speed = mode === 'time';
    const name = speed ? '速度榜' : '价格榜';
    const metric = speed ? '可比用时' : '可比费用';
    const order = speed ? '按每题平均用时升序' : '按相对价格升序';
    const detail = `${scope} · ${metric} ${table.dataset.comparable} / ${table.dataset.participants} · ${order} · 整套按有基线的题折算`;
    images.push(...await renderBoardImages([{ table, title: name }], name, detail,
      { look: efficiencyLooks[mode], exchange: `换算汇率 1 USD = ¥${rate}` }));
  }
  await saveImageZip(title, images);
}
