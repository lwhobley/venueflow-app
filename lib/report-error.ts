/**
 * Client-side fatal error reporting.
 *
 * The API reports 5xx to Sentry via AllExceptionsFilter, but nothing on the
 * client did: ErrorBoundary logged only under __DEV__, so a whitescreen in a
 * release build produced no signal at all. This gives that path one place to
 * live and one place to wire a real reporter into.
 *
 * Deliberately dependency-free. `console.error` in a release build still
 * reaches the platform log (Xcode/logcat) and any crash reporter that installs
 * a console hook, which is strictly better than the previous silence. Point
 * `setFatalErrorReporter` at Sentry/Bugsnag from app/_layout.tsx when one is
 * configured.
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
