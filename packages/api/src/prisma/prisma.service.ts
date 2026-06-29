import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantIsolationExtension } from './tenant-isolation.extension';

/**
 * Returns true when the tenant-isolation Prisma extension should be applied.
 *
 * The extension is itself inert unless an AsyncLocalStorage tenant context is
 * bound per-request (see AuthGuard + tenant-context.ts), so this env flag is a
 * second safety: with TENANT_ISOLATION_ENFORCED unset, queries behave exactly
 * as they did before — no Proxy, no extension, no context binding. Flip the
 * flag (and deploy) to enable; unset to roll back instantly.
 */
function tenantIsolationEnforced(): boolean {
  return process.env['TENANT_ISOLATION_ENFORCED'] === 'true';
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const poolSize = parseInt(process.env['DATABASE_POOL_SIZE'] ?? '20', 10) || 20;
    const url = process.env['DATABASE_URL'];
    const needsPoolParam = url && !url.includes('connection_limit');
    const resolvedUrl = needsPoolParam
      ? `${url}${url.includes('?') ? '&' : '?'}connection_limit=${poolSize}`
      : url;
    super({
      ...(resolvedUrl ? { datasourceUrl: resolvedUrl } : {}),
      log: process.env['NODE_ENV'] === 'production' ? ['error', 'warn'] : ['error', 'warn', 'query'],
    });

    if (!tenantIsolationEnforced()) return;

    // prisma.$extends() returns a NEW client (it never mutates the base), so to
    // keep the PrismaService injection token unchanged across the codebase we
    // wrap `this` in a Proxy that delegates everything Prisma-related to the
    // extended client. Nest lifecycle methods (onModuleInit/Destroy) stay on the
    // wrapper. Inside the extended client, $transaction's tx callback also has
    // the extension applied, so transactions are scoped too.
    const extended = this.$extends(tenantIsolationExtension()) as unknown as PrismaClient;
    Logger.log('Tenant isolation Prisma extension applied', 'PrismaService');

    return new Proxy(this, {
      get(target, prop, receiver) {
        // Keep Nest lifecycle hooks (and the constructor symbol) on the wrapper.
        if (prop === 'onModuleInit' || prop === 'onModuleDestroy' || prop === 'constructor') {
          return Reflect.get(target, prop, receiver);
        }
        const value = (extended as unknown as Record<string | symbol, unknown>)[prop as string];
        if (typeof value === 'function') return (value as Function).bind(extended);
        return value;
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
