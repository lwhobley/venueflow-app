import { describe, expect, it } from 'vitest';
import { canonicalPayload as serverCanonical } from '../packages/api/src/modules/attestation/attestation.service';
import { canonicalPayload as clientCanonical } from './attestation-payload';

/**
 * The device signs the client's canonical string; the server verifies the
 * signature against its own. If the two ever diverge by even one byte, every
 * assertion fails to verify and — once ATTESTATION_ENFORCED is on — nobody can
 * clock in. This test is the guard on that contract.
 */
describe('canonicalPayload client/server parity', () => {
  const cases: Array<[string, unknown]> = [
    ['a real punch payload', { lat: 40.7127, lng: -74.0059, accuracy: 12.5, mocked: false }],
    ['keys in a different order', { mocked: false, accuracy: 12.5, lng: -74.0059, lat: 40.7127 }],
    ['negative and zero values', { lat: 0, lng: -0.5, accuracy: 0, mocked: true }],
    ['nested objects', { outer: { b: 1, a: { d: 4, c: 3 } }, arr: [{ z: 1, y: 2 }] }],
    ['null and undefined-ish values', { a: null, b: 'x', c: 0, d: false }],
    ['unicode strings', { note: 'café — naïve “quotes”' }],
    ['empty object', {}],
    ['array payload', [3, 1, 2]],
  ];

  for (const [name, payload] of cases) {
    it(`matches for ${name}`, () => {
      expect(clientCanonical(payload, 'challenge-1')).toEqual(serverCanonical(payload, 'challenge-1'));
    });
  }

  it('produces a different string when the challenge changes', () => {
    const a = clientCanonical({ lat: 1 }, 'c1');
    const b = clientCanonical({ lat: 1 }, 'c2');
    expect(a).not.toEqual(b);
    expect(b).toEqual(serverCanonical({ lat: 1 }, 'c2'));
  });

  it('produces a different string when any field changes', () => {
    const base = { lat: 40.7127, lng: -74.0059, accuracy: 12.5, mocked: false };
    expect(clientCanonical(base, 'c')).not.toEqual(clientCanonical({ ...base, lat: 40.7128 }, 'c'));
    expect(clientCanonical(base, 'c')).not.toEqual(clientCanonical({ ...base, mocked: true }, 'c'));
  });
});
