import type { PdfCanvas, PdfDocument, Rgb } from './pdf-document.ts';
import { fitText, textWidth } from './winansi.ts';

export interface Column {
  title: string;
  width: number;
  align?: 'left' | 'right';
}

const INK: Rgb = [0.12, 0.13, 0.16];
const MUTED: Rgb = [0.45, 0.47, 0.52];
const RULE: Rgb = [0.86, 0.87, 0.9];
const HEADER_FILL: Rgb = [0.95, 0.95, 0.97];
const ROW_HEIGHT = 15;
const CELL_PADDING = 4;
const FONT_SIZE = 8;

/** Top-to-bottom flow with automatic page breaks; table headers repeat on every page. */
export function createFlowLayout(
  doc: PdfDocument,
  options: { margin: number; footer: (pageNumber: number) => string },
) {
  const { margin } = options;
  let page: PdfCanvas = doc.addPage();
  let y = 0;

  function startPage(): void {
    y = page.height - margin;
    page.text(margin, margin / 2, options.footer(doc.pageCount()), { size: 7, color: MUTED });
  }
  startPage();

  const contentWidth = () => page.width - margin * 2;

  /** Starts a new page unless `height` points still fit (above the footer). */
  function ensure(height: number): boolean {
    if (y - height >= margin) return false;
    page = doc.addPage();
    startPage();
    return true;
  }

  function cellText(
    x: number,
    width: number,
    text: string,
    column: Column,
    bold: boolean,
    color: Rgb,
  ) {
    const fitted = fitText(text, width - CELL_PADDING * 2, FONT_SIZE, bold);
    const tx =
      column.align === 'right'
        ? x + width - CELL_PADDING - textWidth(fitted, FONT_SIZE, bold)
        : x + CELL_PADDING;
    page.text(tx, y - ROW_HEIGHT + 4.5, fitted, { size: FONT_SIZE, bold, color });
  }

  function tableHeader(columns: readonly Column[]): void {
    page.rect(margin, y - ROW_HEIGHT, contentWidth(), ROW_HEIGHT, HEADER_FILL);
    let x = margin;
    for (const column of columns) {
      cellText(x, column.width, column.title, column, true, MUTED);
      x += column.width;
    }
    y -= ROW_HEIGHT;
  }

  return {
    space(height: number): void {
      y -= height;
    },

    heading(text: string, size = 12): void {
      ensure(size + ROW_HEIGHT * 3);
      page.text(margin, y - size, text, { size, bold: true, color: INK });
      y -= size + 8;
    },

    text(text: string, size = 9, color: Rgb = MUTED): void {
      ensure(size + 4);
      page.text(margin, y - size, fitText(text, contentWidth(), size), { size, color });
      y -= size + 5;
    },

    /** Label/value pairs side by side, e.g. summary figures. */
    figures(items: readonly { label: string; value: string }[]): void {
      ensure(40);
      const width = contentWidth() / items.length;
      items.forEach((item, i) => {
        const x = margin + i * width;
        page.text(x, y - 8, item.label, { size: 8, color: MUTED });
        page.text(x, y - 26, fitText(item.value, width - 8, 16, true), {
          size: 16,
          bold: true,
          color: INK,
        });
      });
      y -= 40;
    },

    /** Column widths are fractions of the content width if they add up to ≤ 1. */
    table(
      columns: readonly Column[],
      rows: readonly string[][],
      opts: { totalRow?: string[] } = {},
    ) {
      const total = columns.reduce((a, c) => a + c.width, 0);
      const scaled = columns.map((c) => ({
        ...c,
        width: total <= 1 ? c.width * contentWidth() : c.width,
      }));
      ensure(ROW_HEIGHT * 3);
      tableHeader(scaled);
      const all = opts.totalRow ? [...rows, opts.totalRow] : rows;
      all.forEach((row, index) => {
        const isTotal = opts.totalRow !== undefined && index === all.length - 1;
        if (ensure(ROW_HEIGHT)) tableHeader(scaled);
        let x = margin;
        scaled.forEach((column, i) => {
          cellText(x, column.width, row[i] ?? '', column, isTotal, INK);
          x += column.width;
        });
        page.line(
          margin,
          y - ROW_HEIGHT,
          margin + contentWidth(),
          y - ROW_HEIGHT,
          RULE,
          isTotal ? 1 : 0.4,
        );
        y -= ROW_HEIGHT;
      });
      y -= 12;
    },
  };
}
