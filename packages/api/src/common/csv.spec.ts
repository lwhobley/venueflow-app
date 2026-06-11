import { describe, expect, it } from 'vitest';
import { csvCell } from './csv';

describe('csvCell', () => {
  it('quotes plain strings', () => {
    expect(csvCell('hello')).toBe('"hello"');
  });

  it('escapes embedded double quotes', () => {
    expect(csvCell('a "b" c')).toBe('"a ""b"" c"');
  });

  it('neutralizes formula-injection prefixes', () => {
    expect(csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(csvCell('+44 7700')).toBe(`"'+44 7700"`);
    expect(csvCell('-2')).toBe(`"'-2"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
  });

  it('does not prefix numbers', () => {
    expect(csvCell(-2)).toBe('"-2"');
    expect(csvCell(0)).toBe('"0"');
  });

  it('renders null/undefined as an empty cell', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });
});
