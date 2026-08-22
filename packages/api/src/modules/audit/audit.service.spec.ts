import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuditService, sanitizeAuditMetadata } from './audit.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'test-audit-id' }),
      },
    };
    service = new AuditService(mockPrisma as unknown as PrismaService);
  });

  describe('sanitizeAuditMetadata', () => {
    it('redacts passwords, tokens, API keys, and secret values', () => {
      const input = {
        email: 'manager@example.com',
        password: 'SuperSecretPassword123!',
        rawToken: 'jwt-bearer-xyz',
        apiKey: 'sk_live_12345',
        nested: {
          clientSecret: 'secret_value',
          safeField: 'active',
        },
      };

      const result = sanitizeAuditMetadata(input) as any;

      expect(result.email).toBe('manager@example.com');
      expect(result.password).toBe('[REDACTED]');
      expect(result.rawToken).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.nested.clientSecret).toBe('[REDACTED]');
      expect(result.nested.safeField).toBe('active');
    });

    it('handles null/undefined gracefully', () => {
      expect(sanitizeAuditMetadata(null)).toBeUndefined();
      expect(sanitizeAuditMetadata(undefined)).toBeUndefined();
    });
  });

  describe('record', () => {
    it('creates an audit log entry in Prisma', async () => {
      await service.record({
        venueId: 'venue-123',
        actorProfileId: 'profile-abc',
        actorName: 'Alice Manager',
        actorRole: 'owner',
        entityType: 'User',
        entityId: 'user-789',
        action: 'auth.login.success',
        summary: 'User Alice logged in successfully',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        metadata: { role: 'owner' },
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          venueId: 'venue-123',
          actorProfileId: 'profile-abc',
          actorName: 'Alice Manager',
          action: 'auth.login.success',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        }),
      });
    });

    it('does not throw when Prisma fails', async () => {
      mockPrisma.auditLog.create.mockRejectedValueOnce(new Error('DB unreachable'));

      await expect(
        service.record({
          entityType: 'Auth',
          action: 'auth.login.failed',
          summary: 'Failed login attempt',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('cleanup jobs', () => {
    it('deletes audit logs older than 365 days', async () => {
      mockPrisma.auditLog.deleteMany = vi.fn().mockResolvedValue({ count: 42 });
      const count = await service.cleanupOldAuditLogs();
      expect(count).toBe(42);
      expect(mockPrisma.auditLog.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: expect.any(Date) } },
      });
    });

    it('deletes retained time entries older than 3 years', async () => {
      mockPrisma.retainedTimeEntry = { deleteMany: vi.fn().mockResolvedValue({ count: 15 }) };
      const count = await service.cleanupExpiredRetainedTimeEntries();
      expect(count).toBe(15);
      expect(mockPrisma.retainedTimeEntry.deleteMany).toHaveBeenCalledWith({
        where: { originCreatedAt: { lt: expect.any(Date) } },
      });
    });
  });
});
