import { deflateSync } from 'node:zlib';
import { pdfString } from './winansi.ts';

/**
 * A minimal PDF 1.4 writer: pages of text, lines and filled rectangles in the standard
 * Helvetica fonts (no embedding), with compressed content streams.
 */

export type Rgb = readonly [number, number, number];

export interface TextOptions {
  size: number;
  bold?: boolean;
  color?: Rgb;
}

export interface PdfCanvas {
  readonly width: number;
  readonly height: number;
  /** Baseline at (x, y); y grows upwards from the bottom edge, in points. */
  text(x: number, y: number, text: string, options: TextOptions): void;
  rect(x: number, y: number, width: number, height: number, fill: Rgb): void;
  line(x1: number, y1: number, x2: number, y2: number, color: Rgb, width?: number): void;
}

const num = (n: number) => String(Math.round(n * 100) / 100);
const rgb = ([r, g, b]: Rgb) => `${num(r)} ${num(g)} ${num(b)}`;

/** Document-level strings (Info) use UTF-16BE with a BOM, unlike page text (WinAnsi). */
function infoString(text: string): string {
  const utf16be = Buffer.from(text, 'utf16le').swap16();
  return `<FEFF${utf16be.toString('hex').toUpperCase()}>`;
}

function pdfDate(date: Date): string {
  const iso = date.toISOString();
  return `D:${iso.slice(0, 19).replace(/[-:T]/g, '')}Z`;
}

export function createPdfDocument(size: { width: number; height: number }) {
  const pages: Buffer[][] = [];

  function addPage(): PdfCanvas {
    const ops: Buffer[] = [];
    pages.push(ops);
    const push = (s: string | Buffer) => ops.push(typeof s === 'string' ? Buffer.from(s) : s);
    return {
      width: size.width,
      height: size.height,
      text(x, y, text, { size: fontSize, bold = false, color = [0, 0, 0] }) {
        push(`BT ${rgb(color)} rg /${bold ? 'F2' : 'F1'} ${num(fontSize)} Tf `);
        push(`${num(x)} ${num(y)} Td `);
        push(pdfString(text));
        push(' Tj ET\n');
      },
      rect(x, y, width, height, fill) {
        push(`${rgb(fill)} rg ${num(x)} ${num(y)} ${num(width)} ${num(height)} re f\n`);
      },
      line(x1, y1, x2, y2, color, width = 0.5) {
        push(
          `${rgb(color)} RG ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S\n`,
        );
      },
    };
  }

  function toBuffer(info: { title: string; createdAt: Date }): Buffer {
    const chunks: Buffer[] = [];
    const offsets: number[] = [];
    let length = 0;
    const write = (data: string | Buffer) => {
      const buf = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
      chunks.push(buf);
      length += buf.length;
    };
    const object = (id: number, body: (string | Buffer)[]) => {
      offsets[id] = length;
      write(`${id} 0 obj\n`);
      for (const part of body) write(part);
      write('\nendobj\n');
    };

    const firstPageId = 6;
    const pageIds = pages.map((_, i) => firstPageId + i * 2);
    // Header with a comment of high bytes, marking the file as binary.
    write(Buffer.from([...Buffer.from('%PDF-1.4\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    object(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    object(2, [
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ]);
    object(3, [
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ]);
    object(4, [
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ]);
    object(5, [
      `<< /Title ${infoString(info.title)} /Producer (TEMPO) /CreationDate (${pdfDate(info.createdAt)}) >>`,
    ]);
    pages.forEach((ops, i) => {
      const pageId = pageIds[i] ?? 0;
      object(pageId, [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(size.width)} ${num(size.height)}] `,
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
      ]);
      const stream = deflateSync(Buffer.concat(ops));
      object(pageId + 1, [
        `<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`,
        stream,
        '\nendstream',
      ]);
    });

    const count = firstPageId + pages.length * 2;
    const xref = length;
    write(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let id = 1; id < count; id++) write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    write(`trailer\n<< /Size ${count} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return Buffer.concat(chunks);
  }

  return { addPage, toBuffer, pageCount: () => pages.length };
}

export type PdfDocument = ReturnType<typeof createPdfDocument>;
