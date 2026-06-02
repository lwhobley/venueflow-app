// Server-authoritative all-access allowlist. Mirrors lib/permissions.ts on the
// client, but THIS is the enforcement point — client gating is cosmetic. The
// allowlist is read from the ALL_ACCESS_EMAILS env var (comma-separated) so it
// can be configured per-deployment, falling back to the built-in QA account.
const FALLBACK_ALL_ACCESS = ['user@venuewrangler.com'];

function allAccessEmails(): Set<string> {
  const raw = process.env.ALL_ACCESS_EMAILS;
  const list = raw
    ? raw.split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean)
    : FALLBACK_ALL_ACCESS;
  return new Set(list);
}

export function isAllAccessAccount(email: string | null | undefined): boolean {
  return Boolean(email && allAccessEmails().has(email.trim().toLowerCase()));
}
