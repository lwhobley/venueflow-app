import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const poolSize = parseInt(process.env['DATABASE_POOL_SIZE'] ?? '20', 10) || 20;
    const url = process.env['DATABASE_URL'];
    super({
      datasourceUrl: url,
      log: process.env['NODE_ENV'] === 'production' ? ['error', 'warn'] : ['error', 'warn', 'query'],
      ...(url && !url.includes('connection_limit')
        ? { datasources: { db: { url: `${url}${url.includes('?') ? '&' : '?'}connection_limit=${poolSize}` } } }
        : {}),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
