import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { secretsMatch, verifyStripeSignature } from './webhook-auth';

function stripeSig(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

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

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test';
  const body = Buffer.from('{"id":"evt_1","type":"customer.subscription.updated"}');

  it('accepts a valid, fresh signature', () => {
    const sig = stripeSig(body.toString('utf8'), secret);
    expect(verifyStripeSignature(body, sig, secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = stripeSig(body.toString('utf8'), secret);
    expect(verifyStripeSignature(Buffer.from('{"id":"evt_evil"}'), sig, secret)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const sig = stripeSig(body.toString('utf8'), secret);
    expect(verifyStripeSignature(body, sig, 'whsec_other')).toBe(false);
  });

  it('rejects a stale timestamp outside tolerance', () => {
    const old = Math.floor(Date.now() / 1000) - 10_000;
    const sig = stripeSig(body.toString('utf8'), secret, old);
    expect(verifyStripeSignature(body, sig, secret)).toBe(false);
  });

  it('rejects missing inputs', () => {
    expect(verifyStripeSignature(undefined, 't=1,v1=abc', secret)).toBe(false);
    expect(verifyStripeSignature(body, undefined, secret)).toBe(false);
    expect(verifyStripeSignature(body, 't=1,v1=abc', undefined)).toBe(false);
  });
});
