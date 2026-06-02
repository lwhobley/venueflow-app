import { describe, expect, it } from 'vitest';
import { hasAllAccess, isManager, isOperator } from './authz';
import { reasonFromStatus } from './billing/shared';

describe('isManager', () => {
  it('grants admin, owner, manager', () => {
    expect(isManager('admin')).toBe(true);
    expect(isManager('owner')).toBe(true);
    expect(isManager('manager')).toBe(true);
  });

  it('denies server and staff', () => {
    expect(isManager('server')).toBe(false);
    expect(isManager('staff')).toBe(false);
  });
});

describe('isOperator', () => {
  it('grants manager roles plus server', () => {
    expect(isOperator('admin')).toBe(true);
    expect(isOperator('manager')).toBe(true);
    expect(isOperator('server')).toBe(true);
  });

  it('denies staff', () => {
    expect(isOperator('staff')).toBe(false);
  });
});

describe('hasAllAccess', () => {
  it('only trusts the server-set profile flag', () => {
    expect(hasAllAccess({ allAccess: true } as any)).toBe(true);
    expect(hasAllAccess({ allAccess: false, email: 'user@venuewrangler.com' } as any)).toBe(false);
    expect(hasAllAccess({ email: 'user@venuewrangler.com' } as any)).toBe(false);
  });
});

describe('reasonFromStatus', () => {
  it('returns never_subscribed when no subscription row exists', () => {
    expect(reasonFromStatus(null, false)).toBe('never_subscribed');
    expect(reasonFromStatus('active', false)).toBe('never_subscribed');
  });

  it('maps blocked statuses to their reasons', () => {
    expect(reasonFromStatus('past_due', true)).toBe('payment_failed');
    expect(reasonFromStatus('cancelled', true)).toBe('cancelled');
    expect(reasonFromStatus('expired', true)).toBe('trial_expired');
  });

  it('treats trialing/active as not-yet-blocked', () => {
    expect(reasonFromStatus('trialing', true)).toBe('never_subscribed');
    expect(reasonFromStatus('active', true)).toBe('never_subscribed');
  });
});
