import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { captureException } from '../observability/sentry';

type RequestPathInput = Pick<Request, 'baseUrl' | 'path' | 'originalUrl' | 'url'> & {
  route?: { path?: unknown };
};

/**
 * Return a log-safe route identifier. Never include query strings because some
 * public media routes carry short-lived bearer tokens there. Prefer Express's
 * matched route template so invite codes/tokens in path parameters are also
 * represented as `:code` rather than written to logs.
 */
export function safeRequestPath(request: RequestPathInput): string {
  const routePath = request.route?.path;
  if (typeof routePath === 'string') {
    return `${request.baseUrl ?? ''}${routePath}` || '/';
  }

  const rawPath = request.path || (request.originalUrl ?? request.url ?? '').split('?')[0] || '/';
  // A failure before Express resolves the route has no route template. Redact
  // the one credential-bearing path parameter used by the public invite flow.
  return rawPath.replace(/(\/invite\/)[^/]+/i, '$1:code');
}

/**
 * Global exception filter: logs every error with request context and returns a
 * clean JSON envelope. Unknown errors are mapped to 500 without leaking stack
 * traces or internals to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = String(request.headers['x-request-id'] ?? randomUUID());
    response.setHeader('x-request-id', requestId);

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const safePath = safeRequestPath(request);

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${request.method} ${safePath} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // Report 5xx to Sentry (no-op unless SENTRY_DSN is configured).
      captureException(exception, { requestId, method: request.method, url: safePath });
    } else {
      this.logger.warn(`[${requestId}] ${request.method} ${safePath} -> ${status}`);
    }

    const body =
      typeof message === 'string' ? { statusCode: status, message, requestId } : { ...(message as object), requestId };

    response.status(status).json(body);
  }
}
