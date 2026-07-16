import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const readSite = (path: string) => readFileSync(join(__dirname, path), 'utf8');

describe('website onboarding routes', () => {
  it('verifies an owner email before registering a workspace', () => {
    const source = readSite('index.html');
    expect(source).toContain('id="verificationStep"');
    expect(source).toContain('/v1/auth/verify-email');
    expect(source).toContain('/v1/auth/verify-email/send');
    expect(source).toContain('await api("/v1/auth/verify-email", { method: "POST", body: JSON.stringify({ code }) }, pendingSession.token);');
    expect(source).toContain('await createWorkspace();');
  });

  it('keeps the join form behind a valid invitation token', () => {
    const source = readSite('join/index.html');
    expect(source).toContain('id="join" hidden');
    expect(source).toContain('/v1/app/invite/');
    expect(source).toContain('loadInvite().catch');
    expect(source).toContain('inviteToken: token');
  });
});
