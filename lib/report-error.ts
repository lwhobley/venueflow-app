/**
 * Client-side fatal error reporting.
 *
 * The API reports 5xx to Sentry via AllExceptionsFilter, but nothing on the
 * client did: ErrorBoundary logged only under __DEV__, so a whitescreen in a
 * release build produced no signal at all. This gives that path one place to
 * live and one place to wire a real reporter into.
 *
 * Deliberately dependency-free so the error boundary remains testable without
 * a native SDK. app/_layout.tsx installs the Sentry transport when
 * EXPO_PUBLIC_SENTRY_DSN is configured.
 */
type FatalErrorReporter = (error: Error, componentStack: string | null) => void;

let reporter: FatalErrorReporter | null = null;

/** Install a crash reporter. Call once during app bootstrap. */
export function setFatalErrorReporter(next: FatalErrorReporter | null): void {
  reporter = next;
}

export function reportFatalError(error: Error, componentStack: string | null): void {
  // Never let reporting itself throw out of an error boundary — that would
  // replace a recoverable screen with an unrecoverable one.
  try {
    console.error('[fatal]', error?.message ?? String(error), componentStack ?? '');
    reporter?.(error, componentStack);
  } catch {
    // Intentionally ignored.
  }
}
