import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttestationService, canonicalPayload } from './attestation.service';

function makePrisma(overrides?: {
  challengeUpdateCount?: number;
  device?: unknown;
  deviceUpdateCount?: number;
}) {
  return {
    attestationChallenge: {
      create: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: overrides?.challengeUpdateCount ?? 1 }),
    },
    deviceAttestation: {
      findUnique: vi.fn().mockResolvedValue(
        overrides && 'device' in overrides
          ? overrides.device
          : { keyId: 'key-1', userId: 'user-1', publicKey: 'pem', signCount: 4, environment: 'production' },
      ),
      updateMany: vi.fn().mockResolvedValue({ count: overrides?.deviceUpdateCount ?? 1 }),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

const assertion = { keyId: 'key-1', assertion: 'YXNzZXJ0aW9u', challenge: 'chal-1' };

describe('AttestationService', () => {
  beforeEach(() => {
    delete process.env.ATTESTATION_ENFORCED;
    process.env.APP_ATTEST_TEAM_ID = 'TEAM123456';
  });

  describe('when attestation is not enforced', () => {
    it('allows a punch that carries no attestation, so existing builds keep working', async () => {
      const prisma = makePrisma();
      await expect(
        new AttestationService(prisma).verifyRequest('user-1', { lat: 1 }, undefined),
      ).resolves.toBeUndefined();
      expect(prisma.deviceAttestation.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('when attestation is enforced', () => {
    beforeEach(() => {
      process.env.ATTESTATION_ENFORCED = 'true';
    });

    it('rejects a punch that carries no attestation', async () => {
      await expect(
        new AttestationService(makePrisma()).verifyRequest('user-1', { lat: 1 }, undefined),
      ).rejects.toThrow('cannot verify device integrity');
    });

    it('fails closed when the team identifier is not configured', async () => {
      delete process.env.APP_ATTEST_TEAM_ID;
      await expect(
        new AttestationService(makePrisma()).verifyRequest('user-1', { lat: 1 }, assertion),
      ).rejects.toThrow('APP_ATTEST_TEAM_ID is not configured');
    });
  });

  it('rejects a challenge that is already consumed or expired', async () => {
    const prisma = makePrisma({ challengeUpdateCount: 0 });
    await expect(
      new AttestationService(prisma).verifyRequest('user-1', { lat: 1 }, assertion),
    ).rejects.toThrow('invalid, expired, or already used');
  });

  it('rejects a key that belongs to a different user', async () => {
    const prisma = makePrisma({
      device: { keyId: 'key-1', userId: 'someone-else', publicKey: 'pem', signCount: 4, environment: 'production' },
    });
    await expect(
      new AttestationService(prisma).verifyRequest('user-1', { lat: 1 }, assertion),
    ).rejects.toThrow('not registered for attestation');
  });

  it('rejects an unknown key', async () => {
    const prisma = makePrisma({ device: null });
    await expect(
      new AttestationService(prisma).verifyRequest('user-1', { lat: 1 }, assertion),
    ).rejects.toThrow('not registered for attestation');
  });

  it('rejects a malformed assertion rather than trusting it', async () => {
    // 'YXNzZXJ0aW9u' is not a valid CBOR assertion, so verification must fail.
    const prisma = makePrisma();
    await expect(
      new AttestationService(prisma).verifyRequest('user-1', { lat: 1 }, assertion),
    ).rejects.toThrow('Device integrity check failed');
    // A failed assertion must never advance the stored counter.
    expect(prisma.deviceAttestation.updateMany).not.toHaveBeenCalled();
  });
});

describe('canonicalPayload', () => {
  it('is stable regardless of key insertion order', () => {
    const a = canonicalPayload({ lat: 1, lng: 2, mocked: false }, 'c');
    const b = canonicalPayload({ mocked: false, lng: 2, lat: 1 }, 'c');
    expect(a).toEqual(b);
  });

  it('binds the challenge, so the same payload under a new challenge differs', () => {
    expect(canonicalPayload({ lat: 1 }, 'c1')).not.toEqual(canonicalPayload({ lat: 1 }, 'c2'));
  });

  it('sorts nested object keys too', () => {
    expect(canonicalPayload({ a: { y: 1, x: 2 } }, 'c')).toEqual(canonicalPayload({ a: { x: 2, y: 1 } }, 'c'));
  });

  it('distinguishes different payloads', () => {
    expect(canonicalPayload({ lat: 1 }, 'c')).not.toEqual(canonicalPayload({ lat: 2 }, 'c'));
  });
});
