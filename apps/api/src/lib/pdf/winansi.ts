/**
 * Text support for the standard PDF fonts (Helvetica, Helvetica-Bold) in WinAnsiEncoding:
 * Latin-1 plus typographic punctuation. Characters outside it print as "?".
 */

/** Unicode code points of WinAnsi bytes 0x80–0x9F (0 = unused). */
const HIGH_CONTROL = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0, 0x017d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161,
  0x203a, 0x0153, 0, 0x017e, 0x0178,
];
const FROM_UNICODE = new Map<number, number>(
  HIGH_CONTROL.flatMap((cp, i) => (cp ? [[cp, 0x80 + i] as [number, number]] : [])),
);

/** Helvetica advance widths (1/1000 em) for bytes 0x20–0x7E, from the standard AFM. */
// prettier-ignore
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HIGH_WIDTHS: Record<number, number> = {
  0x85: 1000,
  0x91: 222,
  0x92: 222,
  0x93: 333,
  0x94: 333,
  0x95: 350,
  0x96: 556,
  0x97: 1000,
  0xa0: 278,
};
/** Helvetica-Bold is a little wider; good enough for fitting text into table cells. */
const BOLD_FACTOR = 1.08;

/** Encodes text to WinAnsi bytes (control characters become spaces). */
export function encodeWinAnsi(text: string): Buffer {
  const bytes: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0x3f;
    if (cp < 0x20 || cp === 0x7f) bytes.push(0x20);
    else if (cp < 0x7f || (cp >= 0xa0 && cp <= 0xff)) bytes.push(cp);
    else bytes.push(FROM_UNICODE.get(cp) ?? 0x3f);
  }
  return Buffer.from(bytes);
}

function byteWidth(byte: number): number {
  if (byte >= 0x20 && byte <= 0x7e) return ASCII_WIDTHS[byte - 0x20] ?? 556;
  return HIGH_WIDTHS[byte] ?? 600;
}

/** Width of `text` in points at `size`. */
export function textWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const byte of encodeWinAnsi(text)) units += byteWidth(byte);
  return (units * size * (bold ? BOLD_FACTOR : 1)) / 1000;
}

/** Shortens `text` with an ellipsis so it fits in `maxWidth` points. */
export function fitText(text: string, maxWidth: number, size: number, bold = false): string {
  if (textWidth(text, size, bold) <= maxWidth) return text;
  // No glyph is narrower than 0.19 em, so longer prefixes can never fit.
  const chars = [...text].slice(0, Math.ceil(maxWidth / (size * 0.19)));
  while (chars.length > 0 && textWidth(`${chars.join('')}…`, size, bold) > maxWidth) chars.pop();
  return chars.length > 0 ? `${chars.join('')}…` : '';
}

/** A PDF literal string "(…)" of WinAnsi bytes, with \, ( and ) escaped. */
export function pdfString(text: string): Buffer {
  const out: number[] = [0x28];
  for (const byte of encodeWinAnsi(text)) {
    if (byte === 0x5c || byte === 0x28 || byte === 0x29) out.push(0x5c);
    out.push(byte);
  }
  out.push(0x29);
  return Buffer.from(out);
}
