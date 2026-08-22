import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RecordAuditEventInput {
  venueId?: string | null;
  actorProfileId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  targetProfileId?: string | null;
  targetName?: string | null;
  targetRole?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  summary: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | Prisma.InputJsonObject | null;
}

const REDACTED_KEYS = new Set([
  'password',
  'token',
  'secret',
  'authorization',
  'creditcard',
  'credit_card',
  'ssn',
  'pan',
  'cvv',
  'salt',
  'hash',
  'refreshtoken',
  'accesstoken',
  'idtoken',
  'apikey',
  'api_key',
]);

/**
 * Recursively redacts sensitive keys (passwords, tokens, secrets, PAN/CVV)
 * from audit event metadata to maintain SOC 2 compliance.
 */
export function sanitizeAuditMetadata(
  metadata?: Record<string, any> | Prisma.InputJsonObject | null,
): Prisma.InputJsonValue | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;

  function redact(val: any): any {
    if (val === null || val === undefined) return val;
    if (Array.isArray(val)) return val.map(redact);
    if (typeof val === 'object') {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        const lowerKey = k.toLowerCase().replace(/[-_]/g, '');
        if (
          REDACTED_KEYS.has(lowerKey) ||
          lowerKey.includes('password') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('token')
        ) {
          result[k] = '[REDACTED]';
        } else {
          result[k] = redact(v);
        }
      }
      return result;
    }
    return val;
  }

  return redact(metadata);
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a security or administrative audit event.
   * Runs in non-blocking fashion so audit recording failures
   * do not crash the primary operational transaction, while logging
   * any DB recording errors for observability.
   */
  async record(
    input: RecordAuditEventInput,
    tx?: Prisma.TransactionClient | PrismaService,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const sanitizedMeta = sanitizeAuditMetadata(input.metadata);

    try {
      await client.auditLog.create({
        data: {
          venueId: input.venueId ?? null,
          actorProfileId: input.actorProfileId ?? null,
          actorName: input.actorName ?? null,
          actorRole: input.actorRole ?? null,
          targetProfileId: input.targetProfileId ?? null,
          targetName: input.targetName ?? null,
          targetRole: input.targetRole ?? null,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          action: input.action,
          summary: input.summary,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          metadata: sanitizedMeta ?? Prisma.DbNull,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record audit event [${input.action}] for venue ${input.venueId ?? 'system'}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
