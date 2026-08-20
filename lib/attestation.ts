import * as SecureStore from 'expo-secure-store';
import { attestKey, generateAssertion, generateKey, isAppAttestAvailable } from '../modules/app-attest';
import { apiRequest } from './api-client';
import { canonicalPayload } from './attestation-payload';

export { canonicalPayload };

const KEY_ID_STORE_KEY = 'venuewrangler.appattest.keyId';

export type PunchAttestation = { keyId: string; assertion: string; challenge: string };

async function requestChallenge(): Promise<string> {
  const { challenge } = await apiRequest<{ challenge: string; expiresAt: number }>('/v1/attestation/challenge', {
    method: 'POST',
  });
  return challenge;
}

/**
 * Ensure this install has an App Attest key registered with the server.
 * Idempotent: the key id is cached in SecureStore after the first enrolment.
 */
async function ensureRegisteredKey(): Promise<string> {
  const cached = await SecureStore.getItemAsync(KEY_ID_STORE_KEY);
  if (cached) return cached;

  const keyId = await generateKey();
  const challenge = await requestChallenge();
  const attestation = await attestKey(keyId, challenge);
  await apiRequest('/v1/attestation/ios/register', {
    method: 'POST',
    body: { keyId, attestation, challenge },
  });
  await SecureStore.setItemAsync(KEY_ID_STORE_KEY, keyId);
  return keyId;
}

/**
 * Produce an attestation for one request payload, or null when the device
 * cannot attest (Simulator, Android, Expo Go, older hardware).
 *
 * Returning null rather than throwing is deliberate: while the server has
 * ATTESTATION_ENFORCED=false these punches still succeed, so a device that
 * cannot attest keeps working instead of losing the ability to clock in. Once
 * the server enforces, it rejects the unattested punch with a clear message.
 */
export async function attestPayload(payload: unknown): Promise<PunchAttestation | null> {
  if (!isAppAttestAvailable()) return null;
  try {
    const keyId = await ensureRegisteredKey();
    const challenge = await requestChallenge();
    const assertion = await generateAssertion(keyId, canonicalPayload(payload, challenge));
    return { keyId, assertion, challenge };
  } catch {
    // A failed attestation must not block the punch while enforcement is off.
    // The server logs every rejected assertion, which is how we measure
    // readiness before flipping ATTESTATION_ENFORCED on.
    return null;
  }
}

/** Clears the cached key so the next punch re-enrols (e.g. after sign-out). */
export async function resetAttestationKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_ID_STORE_KEY).catch(() => {});
}
