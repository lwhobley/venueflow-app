import { Logger } from '@nestjs/common';

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
// DATABASE_DIRECT_URL is required because schema.prisma's datasource declares
// `directUrl = env("DATABASE_DIRECT_URL")`. Prisma resolves every env() in that
// block for essentially all CLI operations, so a missing value surfaces as an
// opaque `P1012: Environment variable not found` from Prisma rather than the
// clear boot-time message this function exists to produce.
const REQUIRED_ALWAYS = ['DATABASE_URL', 'DATABASE_DIRECT_URL', 'JWT_SECRET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET'] as const;

// Each entry is a group of env var names where at least one must be set —
// mirrors the fallback pairs the services themselves already accept.
const RECOMMENDED_IN_PRODUCTION: ReadonlyArray<readonly string[]> = [
  ['STRIPE_WEBHOOK_SECRET'],
  ['REVENUECAT_WEBHOOK_SECRET'],
  ['RESEND_API_KEY', 'EMAIL_API_KEY'],
];

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED_ALWAYS.filter((key) => !String(config[key] ?? '').trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  if (config.ATTESTATION_ENFORCED === 'true' && !String(config.APP_ATTEST_TEAM_ID ?? '').trim()) {
    throw new Error('APP_ATTEST_TEAM_ID must be set when ATTESTATION_ENFORCED is enabled.');
  }

  if (config.NODE_ENV === 'production') {
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
