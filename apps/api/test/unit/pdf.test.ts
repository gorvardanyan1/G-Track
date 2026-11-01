import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createPdfDocument } from '../../src/lib/pdf/pdf-document.ts';
import { createFlowLayout } from '../../src/lib/pdf/pdf-layout.ts';
import { encodeWinAnsi, fitText, pdfString, textWidth } from '../../src/lib/pdf/winansi.ts';

describe('WinAnsi text', () => {
  it('encodes Latin-1 and typographic punctuation, and replaces the rest', () => {
    expect([...encodeWinAnsi('Aé–“”…€')]).toEqual([0x41, 0xe9, 0x96, 0x93, 0x94, 0x85, 0x80]);
    expect(encodeWinAnsi('Անահիտ 東').toString('latin1')).toBe('?????? ?');
    expect(encodeWinAnsi('a\nb\u0000').toString('latin1')).toBe('a b ');
  });

  it('escapes PDF string delimiters', () => {
    expect(pdfString('a(b)c\\').toString('latin1')).toBe('(a\\(b\\)c\\\\)');
  });

  it('measures Helvetica widths and fits text with an ellipsis', () => {
    expect(textWidth('MM', 10)).toBeCloseTo(16.66);
    expect(textWidth('ii', 10)).toBeCloseTo(4.44);
    expect(fitText('short', 100, 10)).toBe('short');
    const fitted = fitText('a much longer description than fits', 60, 10);
    expect(fitted.endsWith('…')).toBe(true);
    expect(textWidth(fitted, 10)).toBeLessThanOrEqual(60);
    expect(fitText('W', 1, 10)).toBe('');
  });
});

describe('PDF document', () => {
  function build(rows: number) {
    const doc = createPdfDocument({ width: 842, height: 595 });
    const layout = createFlowLayout(doc, { margin: 36, footer: (n) => `Page ${n}` });
    layout.heading('Title');
    layout.table(
      [
        { title: 'Name', width: 0.7 },
        { title: 'Hours', width: 0.3, align: 'right' },
      ],
      Array.from({ length: rows }, (_, i) => [`Row ${i + 1}`, '01:00:00']),
      { totalRow: ['Total', `${rows}:00:00`] },
    );
    return {
      doc,
      file: doc.toBuffer({ title: 'Test – 1', createdAt: new Date('2026-10-31T12:00:00Z') }),
    };
  }

  const streams = (file: Buffer) => {
    const latin = file.toString('latin1');
    return [...latin.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => {
      const start = (m.index ?? 0) + 'stream\n'.length;
      return inflateSync(file.subarray(start, start + (m[1]?.length ?? 0))).toString('latin1');
    });
  };

  it('writes a valid header, xref table and trailer', () => {
    const { file } = build(3);
    const latin = file.toString('latin1');
    expect(latin.startsWith('%PDF-1.4\n%')).toBe(true);
    // "Test – 1" in UTF-16BE with a BOM.
    expect(latin).toContain(
      '/Title <FEFF00540065007300740020201300200031> /Producer (TEMPO) /CreationDate (D:20261031120000Z)',
    );
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(latin)?.[1]);
    expect(latin.slice(startxref).startsWith('xref\n0 8\n0000000000 65535 f \n')).toBe(true);
    const offsets = latin.slice(startxref).split('\n').slice(3, 10);
    offsets.forEach((line, i) => {
      expect(line).toMatch(/^\d{10} 00000 n $/);
      expect(latin.slice(Number(line.slice(0, 10)))).toMatch(new RegExp(`^${i + 1} 0 obj\\n`));
    });
    expect(latin).toContain('/Size 8 /Root 1 0 R /Info 5 0 R');
  });

  it('breaks long tables across pages and repeats the header', () => {
    const { doc, file } = build(80);
    expect(doc.pageCount()).toBeGreaterThan(1);
    const pages = streams(file);
    expect(pages).toHaveLength(doc.pageCount());
    for (const [i, page] of pages.entries()) {
      expect(page).toContain('(Name)');
      expect(page).toContain(`(Page ${i + 1})`);
    }
    expect(pages.join('')).toContain('(Row 80)');
    expect(pages.at(-1)).toContain('(Total)');
  });
});
