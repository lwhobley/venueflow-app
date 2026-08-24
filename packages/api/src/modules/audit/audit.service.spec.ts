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
      mockPrisma.auditLog.findMany = vi.fn()
        .mockResolvedValueOnce([{ id: 'audit-1' }, { id: 'audit-2' }])
        .mockResolvedValueOnce([]);
      mockPrisma.auditLog.deleteMany = vi.fn().mockResolvedValue({ count: 42 });
      const count = await service.cleanupOldAuditLogs();
      expect(count).toBe(42);
      expect(mockPrisma.auditLog.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['audit-1', 'audit-2'] } },
      });
    });

    it('deletes retained time entries older than 3 years', async () => {
      mockPrisma.retainedTimeEntry = {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: 'wage-1' }])
          .mockResolvedValueOnce([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 15 }),
      };
      const count = await service.cleanupExpiredRetainedTimeEntries();
      expect(count).toBe(15);
      expect(mockPrisma.retainedTimeEntry.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['wage-1'] } },
      });
    });

    it('pages through multiple batches of audit logs until one comes back empty', async () => {
      mockPrisma.auditLog.findMany = vi.fn()
        .mockResolvedValueOnce([{ id: 'audit-1' }, { id: 'audit-2' }])
        .mockResolvedValueOnce([{ id: 'audit-3' }])
        .mockResolvedValueOnce([]);
      mockPrisma.auditLog.deleteMany = vi.fn()
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 1 });

      const count = await service.cleanupOldAuditLogs();

      expect(count).toBe(3);
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledTimes(3);
      expect(mockPrisma.auditLog.deleteMany).toHaveBeenNthCalledWith(1, { where: { id: { in: ['audit-1', 'audit-2'] } } });
      expect(mockPrisma.auditLog.deleteMany).toHaveBeenNthCalledWith(2, { where: { id: { in: ['audit-3'] } } });
    });

    it('propagates a thrown error from cleanupOldAuditLogs without swallowing it', async () => {
      mockPrisma.auditLog.findMany = vi.fn().mockRejectedValue(new Error('db unreachable'));
      mockPrisma.auditLog.deleteMany = vi.fn();

      await expect(service.cleanupOldAuditLogs()).rejects.toThrow('db unreachable');
      expect(mockPrisma.auditLog.deleteMany).not.toHaveBeenCalled();
    });

    it('pages through multiple batches of retained time entries until one comes back empty', async () => {
      mockPrisma.retainedTimeEntry = {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: 'wage-1' }, { id: 'wage-2' }])
          .mockResolvedValueOnce([{ id: 'wage-3' }])
          .mockResolvedValueOnce([]),
        deleteMany: vi.fn()
          .mockResolvedValueOnce({ count: 2 })
          .mockResolvedValueOnce({ count: 1 }),
      };

      const count = await service.cleanupExpiredRetainedTimeEntries();

      expect(count).toBe(3);
      expect(mockPrisma.retainedTimeEntry.findMany).toHaveBeenCalledTimes(3);
      expect(mockPrisma.retainedTimeEntry.deleteMany).toHaveBeenNthCalledWith(1, { where: { id: { in: ['wage-1', 'wage-2'] } } });
      expect(mockPrisma.retainedTimeEntry.deleteMany).toHaveBeenNthCalledWith(2, { where: { id: { in: ['wage-3'] } } });
    });

    it('propagates a thrown error from cleanupExpiredRetainedTimeEntries without swallowing it', async () => {
      mockPrisma.retainedTimeEntry = {
        findMany: vi.fn().mockRejectedValue(new Error('db unreachable')),
        deleteMany: vi.fn(),
      };

      await expect(service.cleanupExpiredRetainedTimeEntries()).rejects.toThrow('db unreachable');
      expect(mockPrisma.retainedTimeEntry.deleteMany).not.toHaveBeenCalled();
    });
  });
});
