import { describe, expect, it } from 'vitest';
import { secretsMatch } from './webhook-auth';

describe('secretsMatch', () => {
  it('matches identical secrets', () => {
    expect(secretsMatch('abc123', 'abc123')).toBe(true);
  });

  it('rejects different secrets of equal length', () => {
    expect(secretsMatch('abc123', 'abc124')).toBe(false);
  });

  it('rejects length mismatches', () => {
    expect(secretsMatch('abc', 'abcd')).toBe(false);
  });

  it('rejects when either value is missing', () => {
    expect(secretsMatch(undefined, 'x')).toBe(false);
    expect(secretsMatch('x', null)).toBe(false);
    expect(secretsMatch('', 'x')).toBe(false);
  });
});
