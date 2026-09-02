import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { getClientIp } from '../../common/http';
import { AuditService } from './audit.service';
import { AUDITED_METADATA_KEY, AuditedOptions } from './audited.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const meta = this.reflector.get<AuditedOptions>(
      AUDITED_METADATA_KEY,
      context.getHandler(),
    );

    if (!meta) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: async (result) => {
          try {
            const http = context.switchToHttp();
            const req = http.getRequest();
            const scope = req?.venueScope;
            const user = req?.user;
            const ip = req ? getClientIp(req) : null;
            const userAgent = (req?.headers && req.headers['user-agent']) || null;

            const venueId = scope?.venueId ?? user?.venueId ?? req?.params?.venueId ?? null;
            const actorProfileId = scope?.profileId ?? user?.profileId ?? user?.id ?? null;
            const actorName = scope?.fullName ?? user?.fullName ?? user?.email ?? 'Unknown Actor';
            const actorRole = scope?.role ?? user?.role ?? null;

            let resultCount: number | undefined;
            let resultSize: number | undefined;

            if (typeof result === 'string') {
              resultSize = result.length;
            } else if (Buffer.isBuffer(result)) {
              resultSize = result.length;
            } else if (Array.isArray(result)) {
              resultCount = result.length;
            } else if (result && typeof result === 'object') {
              if (Array.isArray(result.rows)) {
                resultCount = result.rows.length;
              } else if (Array.isArray(result.items)) {
                resultCount = result.items.length;
              } else if (typeof result.count === 'number') {
                resultCount = result.count;
              }
            }

            await this.audit.record({
              venueId,
              actorProfileId,
              actorName,
              actorRole,
              entityType: meta.entityType ?? 'system',
              entityId: req?.params?.id ?? null,
              action: meta.action,
              summary: meta.summary ?? `${actorName} performed ${meta.action}`,
              ipAddress: ip,
              userAgent,
              metadata: {
                path: req?.originalUrl || req?.url,
                method: req?.method,
                ...(resultCount !== undefined ? { resultCount } : {}),
                ...(resultSize !== undefined ? { resultSize } : {}),
              },
            });
          } catch (error) {
            this.logger.error(
              `AuditInterceptor failed for ${meta.action}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
      }),
    );
  }
}
