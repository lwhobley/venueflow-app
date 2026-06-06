import { Controller, Get } from '@nestjs/common';
import { Public } from '../../auth/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('v1/insights')
export class InsightsController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async getLatestInsights() {
    const rows = await this.prisma.cosmicInsight.findMany({
      orderBy: { batchAt: 'desc' },
      take: 3,
    });
    return rows.map((r) => ({ kind: r.kind, title: r.title, body: r.body }));
  }
}
