import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './auth/public.decorator';
import { PrismaService } from './prisma/prisma.service';

@SkipThrottle()
@Controller()
export class HealthController {
  private lastDbCheck = 0;
  private readonly dbCacheTtlMs = 15_000;

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  root() {
    return {
      message: 'Venue Wrangler API is running',
      health: '/api/health',
    };
  }

  @Public()
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
  @Get('health')
  async health() {
    const now = Date.now();
    // Cache the database ping for 15 seconds to prevent unbounded public scrape
    // / health-monitor bursts from overloading the connection pool.
    if (now - this.lastDbCheck >= this.dbCacheTtlMs) {
      await this.prisma.$queryRaw`SELECT 1`;
      this.lastDbCheck = now;
    }
    return {
      ok: true,
      service: 'venue-wrangler-api',
      time: new Date().toISOString(),
    };
  }
}
