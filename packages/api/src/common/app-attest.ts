import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Configuration and policy for Apple App Attest.
 *
 * Attestation proves a request came from a genuine, unmodified build of our app
 * on real Apple hardware. It is the only thing that makes the geofenced time
 * clock meaningful: lat/lng/mocked are all supplied by the client, so without
 * device attestation any holder of a valid token can post the venue's
 * coordinates from anywhere (see common/geofence.ts).
 *
 * Enforcement is staged on purpose. `ATTESTATION_ENFORCED` defaults to false so
 * that shipping the server ahead of the iOS release does not lock every
 * already-installed app out of clocking in. While it is false the server still
 * verifies any attestation it receives and logs failures — it just does not
 * reject unattested punches. Flip it to true once the install base has updated.
 */
export type AttestationMode = 'observe' | 'enforce';

/**
 * Returns current attestation mode: 'observe' (verify if present, don't reject unattested)
 * or 'enforce' (reject punches lacking valid attestation).
 */
export function getAttestationMode(): AttestationMode {
  const explicit = process.env['DEVICE_ATTESTATION_MODE']?.trim().toLowerCase();
  if (explicit === 'enforce') return 'enforce';
  if (explicit === 'observe') return 'observe';
  return process.env['ATTESTATION_ENFORCED'] === 'true' ? 'enforce' : 'observe';
}

export function attestationEnforced(): boolean {
  return getAttestationMode() === 'enforce';
}

/** Apple Team ID, e.g. "V8H6LQ9448". Required whenever attestation is used. */
export function appAttestTeamId(): string | undefined {
  const value = process.env['APP_ATTEST_TEAM_ID']?.trim();
  return value || undefined;
}

/** iOS bundle identifier the attestation must be bound to. */
export function appAttestBundleId(): string {
  return process.env['APP_ATTEST_BUNDLE_ID']?.trim() || 'com.venuewrangler.app';
}

/**
 * Whether to accept attestations produced by Apple's *development* App Attest
 * environment. Never true in production: a development attestation can be
 * produced from a debug build on a jailbroken device, which would defeat the
 * entire control.
 */
export function allowDevelopmentAttestation(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env['APP_ATTEST_ALLOW_DEVELOPMENT'] === 'true';
}

export class AttestationError extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.FORBIDDEN);
  }
}

/**
 * Misconfiguration must fail closed once enforcement is on: without a team id
 * we cannot bind an attestation to our app, and silently skipping the check
 * would leave the time clock unprotected while appearing enforced.
 */
export function requireAttestationConfig(): { appId: string; developmentEnv: boolean } {
  const teamIdentifier = appAttestTeamId();
  if (!teamIdentifier) {
    throw new HttpException(
      'Device attestation is enabled but APP_ATTEST_TEAM_ID is not configured.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  // Apple's App ID format is <10-digit team id>.<bundle id>.
  return { appId: `${teamIdentifier}.${appAttestBundleId()}`, developmentEnv: allowDevelopmentAttestation() };
}
