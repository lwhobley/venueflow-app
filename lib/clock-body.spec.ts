import { describe, expect, it } from 'vitest';
import { locationBody } from './clock-body';

const punch = { lat: 29.76, lng: -95.37, accuracy: 8, mocked: false };

describe('locationBody', () => {
  it('forwards App Attest when the punch includes it', () => {
    const attestation = { keyId: 'key-1', assertion: 'assert-1', challenge: 'chal-1' };
    expect(locationBody({ ...punch, attestation })).toEqual({ ...punch, attestation });
  });

  it('omits attestation when the device cannot produce one', () => {
    expect(locationBody(punch)).toEqual(punch);
    expect(locationBody({ ...punch, attestation: null })).toEqual(punch);
  });
});
