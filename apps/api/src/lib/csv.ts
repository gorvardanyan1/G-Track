/**
 * RFC 4180 CSV. Cells that a spreadsheet would run as a formula (=, +, -, @, tab, CR) get a
 * leading apostrophe so exported descriptions can't inject formulas (CSV injection).
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | boolean | null): string {
  if (value === null) return '';
  if (typeof value !== 'string') return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const BOM = '\uFEFF';

/** UTF-8 BOM so Excel detects the encoding; CRLF line endings per RFC 4180. */
export function toCsv(rows: readonly (readonly (string | number | boolean | null)[])[]): string {
  return `${BOM}${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
