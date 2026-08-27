/**
 * Canonical form of the data a device signs for App Attest.
 *
 * Deliberately dependency-free (no React Native, no Expo) so it can be unit
 * tested directly against the server's implementation — see
 * attestation-parity.spec.ts. It MUST stay byte-identical to canonicalPayload()
 * in packages/api/src/modules/attestation/attestation.service.ts: the device
 * signs this string and the server verifies against its own copy, so any
 * divergence makes every assertion fail.
 *
 * JSON.stringify preserves insertion order, which differs between client and
 * server, so keys are sorted explicitly on both sides.
 */
export function canonicalPayload(payload: unknown, challenge: string): string {
  return JSON.stringify({ challenge, payload: sortValue(payload) });
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortValue(entry)]),
    );
  }
  return value;
}
