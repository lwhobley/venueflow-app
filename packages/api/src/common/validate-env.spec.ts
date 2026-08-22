import { describe, expect, it, vi } from 'vitest';
import { validateEnv } from './validate-env';

const REQUIRED = {
  DATABASE_URL: 'postgres://localhost/test',
  JWT_SECRET: 'secret',
  AWS_ACCESS_KEY_ID: 'key',
  AWS_SECRET_ACCESS_KEY: 'secret',
  AWS_S3_BUCKET: 'bucket',
};

describe('validateEnv', () => {
  it('passes config through unchanged when every required var is set', () => {
    const config = { ...REQUIRED, NODE_ENV: 'development' };
    expect(validateEnv(config)).toBe(config);
  });

  it('throws naming every missing required var', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow(
      /DATABASE_URL, JWT_SECRET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET/,
    );
  });

  it('does not require the migration-only direct URL in a serving process', () => {
    expect(() => validateEnv({ ...REQUIRED, NODE_ENV: 'production' })).not.toThrow();
  });

  it('throws when a required var is present but blank', () => {
    expect(() => validateEnv({ ...REQUIRED, JWT_SECRET: '   ' })).toThrow(/JWT_SECRET/);
  });

  it('does not throw in production when optional integrations are unset, but warns', () => {
    const warnSpy = vi.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => {});
    expect(() => validateEnv({ ...REQUIRED, NODE_ENV: 'production' })).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('STRIPE_WEBHOOK_SECRET'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('REVENUECAT_WEBHOOK_SECRET'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('REVENUECAT_API_KEY or REVENUECAT_SECRET_API_KEY'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RESEND_API_KEY or EMAIL_API_KEY'));
    warnSpy.mockRestore();
  });

  it('does not warn outside production', () => {
    const warnSpy = vi.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => {});
    validateEnv({ ...REQUIRED, NODE_ENV: 'development' });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not warn in production when the fallback of a pair is set', () => {
    const warnSpy = vi.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => {});
    validateEnv({ ...REQUIRED, NODE_ENV: 'production', STRIPE_WEBHOOK_SECRET: 'x', REVENUECAT_WEBHOOK_SECRET: 'x', REVENUECAT_API_KEY: 'x', EMAIL_API_KEY: 'x' });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('fails fast when production billing is enabled without verification credentials', () => {
    expect(() => validateEnv({ ...REQUIRED, NODE_ENV: 'production', BILLING_ENABLED: 'true' })).toThrow(
      /REVENUECAT_WEBHOOK_SECRET, REVENUECAT_API_KEY/,
    );
    expect(() => validateEnv({
      ...REQUIRED,
      NODE_ENV: 'production',
      BILLING_ENABLED: 'true',
      REVENUECAT_WEBHOOK_SECRET: 'webhook',
      REVENUECAT_API_KEY: 'secret',
    })).not.toThrow();
  });

  it('throws if ATTESTATION_ENFORCED is true but APP_ATTEST_TEAM_ID is missing', () => {
    expect(() =>
      validateEnv({ ...REQUIRED, ATTESTATION_ENFORCED: 'true' }),
    ).toThrow('APP_ATTEST_TEAM_ID must be set when ATTESTATION_ENFORCED is enabled.');
  });

  it('passes when ATTESTATION_ENFORCED is true and APP_ATTEST_TEAM_ID is provided', () => {
    expect(() =>
      validateEnv({ ...REQUIRED, ATTESTATION_ENFORCED: 'true', APP_ATTEST_TEAM_ID: 'TEAM123' }),
    ).not.toThrow();
  });
});
