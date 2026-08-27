import { requireOptionalNativeModule } from 'expo-modules-core';

type AppAttestNativeModule = {
  isSupported: () => boolean;
  generateKey: () => Promise<string>;
  attestKey: (keyId: string, challenge: string) => Promise<string>;
  generateAssertion: (keyId: string, clientData: string) => Promise<string>;
};

/**
 * Optional on purpose: the module only exists in native iOS builds. On web, on
 * Android, and in Expo Go this resolves to null and callers degrade gracefully
 * rather than crashing.
 */
const AppAttest = requireOptionalNativeModule<AppAttestNativeModule>('AppAttest');

export function isAppAttestAvailable(): boolean {
  try {
    return Boolean(AppAttest?.isSupported());
  } catch {
    return false;
  }
}

export function generateKey(): Promise<string> {
  if (!AppAttest) throw new Error('App Attest is not available in this build.');
  return AppAttest.generateKey();
}

/** Returns a base64 attestation over SHA256(challenge). */
export function attestKey(keyId: string, challenge: string): Promise<string> {
  if (!AppAttest) throw new Error('App Attest is not available in this build.');
  return AppAttest.attestKey(keyId, challenge);
}

/** Returns a base64 assertion over SHA256(clientData). */
export function generateAssertion(keyId: string, clientData: string): Promise<string> {
  if (!AppAttest) throw new Error('App Attest is not available in this build.');
  return AppAttest.generateAssertion(keyId, clientData);
}
