import { createHash } from 'crypto';

// Invite bearer tokens are never persisted in plaintext (unlike the short,
// human-typed `code`) — only their sha256 hash is stored, mirroring how
// Session.tokenHash works. Callers hash whatever the client submits and
// look up by `tokenHash` instead of a plaintext `token` column.
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
