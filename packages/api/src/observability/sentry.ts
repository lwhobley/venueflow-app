import * as Sentry from '@sentry/node';

/**
 * Error tracking via Sentry, env-gated. Inert unless SENTRY_DSN is set, so this
 * is safe to ship — it activates only once the DSN is configured (e.g. in
 * Railway). Wrapping the SDK keeps the exception filter decoupled from Sentry.
 */
let enabled = false;

export function initSentry(): boolean {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    // Error capture only — no performance tracing by default.
    tracesSampleRate: 0,
  });
  enabled = true;
  return true;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

/** Drain queued events for short-lived workers before their process exits. */
export async function flushSentry(timeoutMs = 2_000): Promise<boolean> {
  if (!enabled) return true;
  return Sentry.flush(timeoutMs);
}
