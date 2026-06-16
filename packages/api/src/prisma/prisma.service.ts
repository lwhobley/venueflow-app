import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
