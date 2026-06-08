import { Body, Controller, ForbiddenException, Get, Post, Query } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import * as crypto from 'crypto';
import { isAdminRole } from '../../auth/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

function dayBounds(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(0, 0, 0, 0);
  return { start: d.getTime(), end: d.getTime() + 86_400_000 };
}

function isoDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

class SalesWindowQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  windowDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  startTs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  endTs?: number;
}

class TopItemsQueryDto extends SalesWindowQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}

class UpsertPosConnectionDto {
  @IsIn(['toast', 'square', 'clover', 'generic'])
  provider!: string;

  @IsOptional()
  @IsString()
  externalLocationId?: string;

  @IsIn(['connected', 'paused', 'error'])
  status!: string;
}

@Controller('v1/pos')
export class PosController {
  constructor(private readonly prisma: PrismaService) {}

  private requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
    if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
  }

  // Resolve the [start, end) window for a sales query, defaulting to the last
  // `windowDays` days (inclusive of today).
  private resolveWindow(query: SalesWindowQueryDto) {
    const windowDays = Math.min(Math.max(1, Math.round(query.windowDays ?? 7)), 90);
    const start = query.startTs ?? dayBounds(-windowDays + 1).start;
    const end = query.endTs !== undefined ? query.endTs + 1 : dayBounds(1).start;
    return { start: new Date(start), end: new Date(end) };
  }

  @RequireSubscription('paid')
  @Get('overview')
  async getPosOverview(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const venueId = scope.venueId;
    const { start: dayStart } = dayBounds(0);
    const dayStartDate = new Date(dayStart);

    const [connections, recentChecks, todayTotals, openChecks] = await Promise.all([
      this.prisma.posConnection.findMany({ where: { venueId }, take: 10 }),
      this.prisma.posCheck.findMany({ where: { venueId }, orderBy: { openedAt: 'desc' }, take: 50 }),
      this.prisma.posCheck.aggregate({
        where: { venueId, openedAt: { gte: dayStartDate }, status: { not: 'void' } },
        _sum: { totalCents: true, tipCents: true },
      }),
      this.prisma.posCheck.count({ where: { venueId, status: 'open' } }),
    ]);

    const lastSyncAt = connections.reduce<number | null>((latest, conn) => {
      if (!conn.lastSyncAt) return latest;
      const ts = conn.lastSyncAt.getTime();
      return latest == null ? ts : Math.max(latest, ts);
    }, null);

    return {
      connections: connections.map((c) => this.mapConnection(c)),
      recentChecks: recentChecks.map((c) => this.mapCheck(c)),
      todaySalesCents: num(todayTotals._sum.totalCents),
      todayTipsCents: num(todayTotals._sum.tipCents),
      openChecks,
      lastSyncAt,
    };
  }

  @RequireSubscription('paid')
  @Get('sales/summary')
  async getSalesSummaryDashboard(@VenueScope() scope: Scope, @Query() query: SalesWindowQueryDto) {
    this.requireManager(scope);
    const venueId = scope.venueId;
    const { start, end } = this.resolveWindow(query);

    // Aggregate in SQL so totals are correct regardless of volume (no row cap).
    const [totalsRows, byDayRows, byTender, byRevenueCenter] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          salesCents: bigint; taxCents: bigint; tipCents: bigint; discountCents: bigint;
          compCents: bigint; promoCents: bigint; checkCount: number; coverCount: bigint;
          avgCheckTimeMins: number | string | null;
        }>
      >`
        SELECT
          COALESCE(SUM("totalCents"), 0)::bigint AS "salesCents",
          COALESCE(SUM("taxCents"), 0)::bigint AS "taxCents",
          COALESCE(SUM("tipCents"), 0)::bigint AS "tipCents",
          COALESCE(SUM("discountCents"), 0)::bigint AS "discountCents",
          COALESCE(SUM("compCents"), 0)::bigint AS "compCents",
          COALESCE(SUM("promoCents"), 0)::bigint AS "promoCents",
          COUNT(*)::int AS "checkCount",
          COALESCE(SUM(COALESCE("guestCount", 1)), 0)::bigint AS "coverCount",
          AVG(EXTRACT(EPOCH FROM ("closedAt" - "openedAt")) / 60.0)
            FILTER (WHERE "closedAt" IS NOT NULL) AS "avgCheckTimeMins"
        FROM "PosCheck"
        WHERE "venueId" = ${venueId}
          AND "openedAt" >= ${start} AND "openedAt" < ${end}
          AND "status"::text <> 'void'
      `,
      this.prisma.$queryRaw<
        Array<{ date: string; salesCents: bigint; checkCount: number; coverCount: bigint }>
      >`
        SELECT to_char("openedAt", 'YYYY-MM-DD') AS date,
          COALESCE(SUM("totalCents"), 0)::bigint AS "salesCents",
          COUNT(*)::int AS "checkCount",
          COALESCE(SUM(COALESCE("guestCount", 1)), 0)::bigint AS "coverCount"
        FROM "PosCheck"
        WHERE "venueId" = ${venueId}
          AND "openedAt" >= ${start} AND "openedAt" < ${end}
          AND "status"::text <> 'void'
        GROUP BY 1 ORDER BY 1
      `,
      this.prisma.posCheck.groupBy({
        by: ['tenderType'],
        where: { venueId, openedAt: { gte: start, lt: end }, status: { not: 'void' } },
        _sum: { totalCents: true },
        _count: { _all: true },
      }),
      this.prisma.posCheck.groupBy({
        by: ['revenueCenter'],
        where: { venueId, openedAt: { gte: start, lt: end }, status: { not: 'void' } },
        _sum: { totalCents: true, guestCount: true },
        _count: { _all: true },
      }),
    ]);

    const totals = totalsRows[0];
    const checkCount = num(totals?.checkCount);
    const salesCents = num(totals?.salesCents);

    return {
      summary: {
        salesCents,
        taxCents: num(totals?.taxCents),
        tipCents: num(totals?.tipCents),
        discountCents: num(totals?.discountCents),
        compCents: num(totals?.compCents),
        promoCents: num(totals?.promoCents),
        checkCount,
        coverCount: num(totals?.coverCount),
        avgCheckCents: checkCount ? Math.round(salesCents / checkCount) : 0,
        avgCheckTimeMins: totals?.avgCheckTimeMins != null ? Math.round(num(totals.avgCheckTimeMins)) : null,
      },
      byDay: byDayRows.map((r) => ({
        date: r.date,
        salesCents: num(r.salesCents),
        checkCount: num(r.checkCount),
        coverCount: num(r.coverCount),
      })),
      byTender: byTender
        .map((r) => ({
          tenderType: r.tenderType?.trim() || 'Unknown',
          salesCents: num(r._sum.totalCents),
          checkCount: r._count._all,
        }))
        .sort((a, b) => b.salesCents - a.salesCents),
      byRevenueCenter: byRevenueCenter
        .map((r) => ({
          revenueCenter: r.revenueCenter?.trim() || 'Default',
          salesCents: num(r._sum.totalCents),
          checkCount: r._count._all,
          coverCount: num(r._sum.guestCount),
        }))
        .sort((a, b) => b.salesCents - a.salesCents),
    };
  }

  @RequireSubscription('paid')
  @Get('sales/by-server')
  async getSalesByServer(@VenueScope() scope: Scope, @Query() query: SalesWindowQueryDto) {
    this.requireManager(scope);
    const { start, end } = this.resolveWindow(query);

    const rows = await this.prisma.posCheck.groupBy({
      by: ['serverName'],
      where: { venueId: scope.venueId, openedAt: { gte: start, lt: end }, status: { not: 'void' } },
      _sum: { totalCents: true, tipCents: true, discountCents: true, compCents: true, guestCount: true },
      _count: { _all: true },
    });

    return rows
      .map((r) => {
        const salesCents = num(r._sum.totalCents);
        const checkCount = r._count._all;
        return {
          serverName: r.serverName?.trim() || 'Unknown',
          salesCents,
          tipCents: num(r._sum.tipCents),
          discountCents: num(r._sum.discountCents),
          compCents: num(r._sum.compCents),
          checkCount,
          coverCount: num(r._sum.guestCount),
          avgCheckCents: checkCount ? Math.round(salesCents / checkCount) : 0,
        };
      })
      .sort((a, b) => b.salesCents - a.salesCents);
  }

  @RequireSubscription('paid')
  @Get('sales/top-items')
  async getTopMenuItems(@VenueScope() scope: Scope, @Query() query: TopItemsQueryDto) {
    this.requireManager(scope);
    const { start, end } = this.resolveWindow(query);
    const cap = Math.min(Math.max(1, Math.round(query.limit ?? 20)), 50);

    // Unnest the menuItems JSON array and aggregate in SQL (no row cap).
    const rows = await this.prisma.$queryRaw<
      Array<{ name: string; category: string | null; quantity: number | string; salesCents: bigint }>
    >`
      SELECT item->>'name' AS name,
        MAX(item->>'category') AS category,
        COALESCE(SUM((item->>'quantity')::numeric), 0)::float8 AS quantity,
        COALESCE(SUM((item->>'priceCents')::numeric * (item->>'quantity')::numeric), 0)::bigint AS "salesCents"
      FROM "PosCheck" c, jsonb_array_elements(c."menuItems") AS item
      WHERE c."venueId" = ${scope.venueId}
        AND c."openedAt" >= ${start} AND c."openedAt" < ${end}
        AND c."status"::text <> 'void'
        AND c."menuItems" IS NOT NULL
        AND jsonb_typeof(c."menuItems") = 'array'
        AND item->>'name' IS NOT NULL
      GROUP BY item->>'name'
      ORDER BY "salesCents" DESC
      LIMIT ${cap}
    `;

    return rows.map((r) => ({
      name: r.name,
      category: r.category ?? null,
      quantity: num(r.quantity),
      salesCents: num(r.salesCents),
    }));
  }

  @RequireSubscription('paid')
  @Get('labor')
  async getLaborSummary(@VenueScope() scope: Scope, @Query() query: SalesWindowQueryDto) {
    this.requireManager(scope);
    const windowDays = Math.min(Math.max(1, Math.round(query.windowDays ?? 7)), 90);
    const startDate = isoDate(query.startTs ?? dayBounds(-windowDays + 1).start);
    const endDate = isoDate(query.endTs ?? dayBounds(0).start);

    const rows = await this.prisma.posLaborPunch.groupBy({
      by: ['externalEmployeeId', 'employeeName', 'jobTitle'],
      where: { venueId: scope.venueId, businessDate: { gte: startDate, lte: endDate } },
      _sum: {
        regularMinutes: true,
        overtimeMinutes: true,
        totalPayCents: true,
        tipsCents: true,
        declaredTipsCents: true,
      },
    });

    let totalRegularMins = 0, totalOvertimeMins = 0, totalPayCents = 0, totalTipsCents = 0;
    const byEmployee = rows
      .map((r) => {
        const regularMins = num(r._sum.regularMinutes);
        const overtimeMins = num(r._sum.overtimeMinutes);
        const payCents = num(r._sum.totalPayCents);
        const tipsCents = num(r._sum.tipsCents) + num(r._sum.declaredTipsCents);
        totalRegularMins += regularMins;
        totalOvertimeMins += overtimeMins;
        totalPayCents += payCents;
        totalTipsCents += tipsCents;
        return { employeeName: r.employeeName, jobTitle: r.jobTitle ?? null, regularMins, overtimeMins, payCents, tipsCents };
      })
      .sort((a, b) => b.payCents - a.payCents);

    return { totalRegularMins, totalOvertimeMins, totalPayCents, totalTipsCents, byEmployee };
  }

  @RequireSubscription('paid')
  @Post('connections')
  async upsertPosConnection(@VenueScope() scope: Scope, @Body() body: UpsertPosConnectionDto) {
    this.requireManager(scope);
    const venueId = scope.venueId;
    const externalLocationId = body.externalLocationId?.trim() || null;
    const now = new Date();

    const existing = await this.prisma.posConnection.findFirst({
      where: {
        venueId,
        provider: body.provider as any,
        ...(externalLocationId ? { externalLocationId } : {}),
      },
    });

    if (existing) {
      const freshSecret = existing.webhookSecret ? null : crypto.randomBytes(32).toString('hex');
      const updated = await this.prisma.posConnection.update({
        where: { id: existing.id },
        data: {
          status: body.status as any,
          externalLocationId,
          updatedAt: now,
          ...(freshSecret ? { webhookSecret: freshSecret } : {}),
        },
      });
      return { ...this.mapConnection(updated), webhookSecret: freshSecret };
    }

    const secret = crypto.randomBytes(32).toString('hex');
    const created = await this.prisma.posConnection.create({
      data: {
        venueId,
        provider: body.provider as any,
        externalLocationId,
        status: body.status as any,
        webhookSecret: secret,
        createdAt: now,
        updatedAt: now,
      },
    });

    return { ...this.mapConnection(created), webhookSecret: secret };
  }

  private mapConnection(conn: {
    id: string;
    venueId: string;
    provider: string;
    externalLocationId: string | null;
    status: string;
    lastSyncAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      _id: conn.id,
      id: conn.id,
      venueId: conn.venueId,
      provider: conn.provider,
      externalLocationId: conn.externalLocationId,
      status: conn.status,
      lastSyncAt: conn.lastSyncAt ? conn.lastSyncAt.getTime() : null,
      createdAt: conn.createdAt.getTime(),
      updatedAt: conn.updatedAt.getTime(),
    };
  }

  private mapCheck(check: {
    id: string;
    venueId: string;
    provider: string;
    externalCheckId: string;
    tableLabel: string | null;
    serverName: string | null;
    guestName: string | null;
    guestCount: number | null;
    openedAt: Date;
    closedAt: Date | null;
    subtotalCents: number;
    taxCents: number | null;
    tipCents: number;
    totalCents: number;
    discountCents: number | null;
    compCents: number | null;
    promoCents: number | null;
    menuItems: unknown;
    status: string;
    updatedAt: Date;
  }) {
    return {
      _id: check.id,
      id: check.id,
      venueId: check.venueId,
      provider: check.provider,
      externalCheckId: check.externalCheckId,
      tableLabel: check.tableLabel,
      serverName: check.serverName,
      guestName: check.guestName,
      guestCount: check.guestCount,
      openedAt: check.openedAt.getTime(),
      closedAt: check.closedAt ? check.closedAt.getTime() : null,
      subtotalCents: check.subtotalCents,
      taxCents: check.taxCents,
      tipCents: check.tipCents,
      totalCents: check.totalCents,
      discountCents: check.discountCents,
      compCents: check.compCents,
      promoCents: check.promoCents,
      menuItems: check.menuItems
        ? (check.menuItems as any[]).map((it) => ({
            name: it.name,
            category: it.category ?? null,
            quantity: it.quantity,
            priceCents: it.priceCents,
          }))
        : null,
      status: check.status,
      updatedAt: check.updatedAt.getTime(),
    };
  }
}
