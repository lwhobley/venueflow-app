/**
 * Quotes a CSV cell and neutralizes spreadsheet formula injection: string
 * values starting with =, +, -, @, tab or CR are prefixed with a single quote
 * so Excel/Sheets treat them as text. Numbers pass through unprefixed.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '""';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}
