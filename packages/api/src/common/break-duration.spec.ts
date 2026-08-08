import { describe, expect, it } from 'vitest';
import { parseTimeBreaks, unpaidBreakMs } from './break-duration';

describe('break duration helpers', () => {
  it('drops malformed persisted break rows and normalizes numeric strings', () => {
    expect(parseTimeBreaks([
      null,
      { startAt: '100', endAt: '200', type: 'unpaid' },
      { startAt: 300, endAt: null, type: 'paid' },
      { startAt: 500, endAt: 400, type: 'unpaid' },
      { startAt: 600, endAt: 700, type: 'invalid' },
    ])).toEqual([
      { startAt: 100, endAt: 200, type: 'unpaid' },
      { startAt: 300, endAt: null, type: 'paid' },
    ]);
  });

  it('returns zero for invalid or inverted unpaid breaks', () => {
    expect(unpaidBreakMs('bad', 200)).toBe(0);
    expect(unpaidBreakMs(200, 100)).toBe(0);
    expect(unpaidBreakMs(100, 250)).toBe(150);
  });
});
