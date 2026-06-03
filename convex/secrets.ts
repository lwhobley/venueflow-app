// Shared secret-handling primitives. Keep the constant-time comparison in ONE
// place — duplicated copies invite a "fast path" optimization in one site that
// silently reintroduces a timing side-channel while the others stay correct.

/** Constant-time string equality. Returns false for null/undefined or
 * length-mismatched inputs (length is not itself secret here). */
export function timingSafeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Generates an opaque 40-char webhook/connection secret. */
export function newWebhookSecret(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 40);
}
