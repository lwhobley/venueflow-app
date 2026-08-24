import { Logger } from '@nestjs/common';
import { APPLE_TEAM_ID_PATTERN } from './app-attest';

const logger = new Logger('Bootstrap');

/**
 * Config validated at boot, wired via ConfigModule.forRoot({ validate }).
 *
 * Hard-fails (throws) only for vars every deployment topology needs to start
 * at all — the same set packages/api/src/test/e2e-app.ts already exports
 * before booting the full module graph, and the same set the S3 services'
 * `config.getOrThrow` calls already require today (this just surfaces the
 * failure at boot, in one place, with a clear message, instead of on first
 * use of whichever provider happens to touch it first).
 *
 * Everything else that's commonly required in production (Stripe/RevenueCat
 * webhook secrets, the email provider key) is deliberately NOT hard-required
 * here: those integrations are legitimately optional in some deployments
 * (e.g. a venue-only staging environment with billing disabled), and failing
 * boot for them would be a worse outage than the silent-401 failure mode
 * they're meant to catch. Instead they're logged loudly in production so an
 * operator sees the gap immediately instead of discovering it when a webhook
 * starts bouncing.
 */
// Serving instances use the pooler URL. DATABASE_DIRECT_URL belongs on the
// single-run migration job; requiring that higher-privilege credential in
// every Cloud Run instance would unnecessarily increase its blast radius.
const REQUIRED_ALWAYS = ['DATABASE_URL', 'JWT_SECRET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET'] as const;

// Each entry is a group of env var names where at least one must be set —
// mirrors the fallback pairs the services themselves already accept.
const RECOMMENDED_IN_PRODUCTION: ReadonlyArray<readonly string[]> = [
  ['STRIPE_WEBHOOK_SECRET'],
  ['REVENUECAT_WEBHOOK_SECRET'],
  ['REVENUECAT_API_KEY', 'REVENUECAT_SECRET_API_KEY'],
  ['RESEND_API_KEY', 'EMAIL_API_KEY'],
  // Without this every captureException() in the codebase is a silent no-op,
  // including the ones guarding background deletion/erasure jobs that never
  // pass through AllExceptionsFilter.
  ['SENTRY_DSN'],
];

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED_ALWAYS.filter((key) => !String(config[key] ?? '').trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const explicitAttestationMode = String(config.DEVICE_ATTESTATION_MODE ?? '').trim().toLowerCase();
  const legacyEnforcementEnabled = config.ATTESTATION_ENFORCED === 'true';
  const rawAttestationMode = explicitAttestationMode || (legacyEnforcementEnabled ? 'enforce' : 'observe');
  const appAttestTeamId = String(config.APP_ATTEST_TEAM_ID ?? '').trim();

  if (!['observe', 'enforce'].includes(rawAttestationMode)) {
    throw new Error('DEVICE_ATTESTATION_MODE must be observe or enforce');
  }

  if (rawAttestationMode === 'enforce' && !appAttestTeamId) {
    throw new Error('APP_ATTEST_TEAM_ID must be set when attestation is enforced.');
  }
  if (appAttestTeamId && !APPLE_TEAM_ID_PATTERN.test(appAttestTeamId)) {
    throw new Error('APP_ATTEST_TEAM_ID must be a 10-character Apple Developer Team ID.');
  }

  if (config.NODE_ENV === 'production') {
    const jwtSecret = String(config.JWT_SECRET ?? '').trim();
    if (jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production.');
    }
    if (!explicitAttestationMode && !legacyEnforcementEnabled) {
      throw new Error('Production requires an explicit DEVICE_ATTESTATION_MODE=observe|enforce');
    }
    if (!appAttestTeamId) {
      throw new Error('APP_ATTEST_TEAM_ID must be set for production attestation.');
    }
    if (rawAttestationMode === 'observe') {
      logger.warn(
        'Device attestation is in observe mode for staged rollout. Punches with attestation assertions will be verified.',
      );
    }
    if (config.BILLING_ENABLED === 'true') {
      const missingBilling = [
        !String(config.REVENUECAT_WEBHOOK_SECRET ?? '').trim() ? 'REVENUECAT_WEBHOOK_SECRET' : null,
        !String(config.REVENUECAT_API_KEY ?? config.REVENUECAT_SECRET_API_KEY ?? '').trim() ? 'REVENUECAT_API_KEY' : null,
      ].filter((value): value is string => Boolean(value));
      if (missingBilling.length > 0) {
        throw new Error(`Billing is enabled but required environment variable(s) are missing: ${missingBilling.join(', ')}`);
      }
    }
    for (const group of RECOMMENDED_IN_PRODUCTION) {
      const isSet = group.some((key) => String(config[key] ?? '').trim());
      if (!isSet) {
        logger.warn(
          `${group.join(' or ')} is not configured. The corresponding integration will reject every request until this is set.`,
        );
      }
    }
  }

  return config;
}
