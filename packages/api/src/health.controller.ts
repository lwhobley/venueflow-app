import { Controller, Get } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Public } from './auth/public.decorator';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class HealthController {
  private lastDbCheck = 0;
  private pendingDbCheck: Promise<void> | null = null;
  private readonly dbCacheTtlMs = 15_000;

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  root() {
    return {
      message: 'Venue Wrangler API is running',
      health: '/api/health',
    };
  }

  @Public()
  @SkipThrottle()
  @Get('healthz')
  liveness() {
    return {
      ok: true,
      status: 'live',
      service: 'venue-wrangler-api',
      time: new Date().toISOString(),
    };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('health')
  async health() {
    const now = Date.now();
    // Cache the database ping for 15 seconds and share concurrent in-flight promises
    // to prevent unthrottled health-check bursts from overwhelming the DB connection pool.
    if (now - this.lastDbCheck >= this.dbCacheTtlMs) {
      if (!this.pendingDbCheck) {
        this.pendingDbCheck = (async () => {
          try {
            await this.prisma.$queryRaw`SELECT 1`;
            this.lastDbCheck = Date.now();
          } finally {
            this.pendingDbCheck = null;
          }
        })();
      }
      await this.pendingDbCheck;
    }
    return {
      ok: true,
      service: 'venue-wrangler-api',
      time: new Date().toISOString(),
    };
  }
}
