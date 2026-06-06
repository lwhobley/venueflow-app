import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import * as crypto from 'crypto';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { RequireSubscription } from '../../billing/require-subscription.decorator';

function isAdminRole(role: string) {
  return role === 'admin' || role === 'owner' || role === 'manager';
}

function isoDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayBounds(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(0, 0, 0, 0);
  return { start: d.getTime(), end: d.getTime() + 86_400_000 };
}

function accumulateCheck(
  acc: { salesCents: number; taxCents: number; tipCents: number; discountCents: number; compCents: number; promoCents: number; checkCount: number; coverCount: number },
  c: { totalCents: number; taxCents: number | null; tipCents: number; discountCents: number | null; compCents: number | null; promoCents: number | null; guestCount: number | null },
) {
  acc.salesCents += c.totalCents;
  acc.taxCents += c.taxCents ?? 0;
  acc.tipCents += c.tipCents;
  acc.discountCents += c.discountCents ?? 0;
  acc.compCents += c.compCents ?? 0;
  acc.promoCents += c.promoCents ?? 0;
  acc.checkCount += 1;
  acc.coverCount += c.guestCount ?? 1;
}

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

  @UseGuards(AuthGuard)
  @RequireSubscription('paid')
  @Get('overview')
  async getPosOverview(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;

    const [connections, checks] = await Promise.all([
      this.prisma.posConnection.findMany({ where: { venueId }, take: 10 }),
      this.prisma.posCheck.findMany({
        where: { venueId },
        orderBy: { openedAt: 'desc' },
        take: 50,
      }),
    ]);

    const { start: dayStart } = dayBounds(0);
    const dayStartDate = new Date(dayStart);
    const todaysChecks = checks.filter((c) => c.openedAt >= dayStartDate);

    const lastSyncAt = connections.reduce<number | null>((latest, conn) => {
      if (!conn.lastSyncAt) return latest;
      const ts = conn.lastSyncAt.getTime();
      return latest == null ? ts : Math.max(latest, ts);
    }, null);

    return {
      connections: connections.map((c) => this.mapConnection(c)),
      recentChecks: checks.map((c) => this.mapCheck(c)),
      todaySalesCents: todaysChecks.reduce((s, c) => s + c.totalCents, 0),
      todayTipsCents: todaysChecks.reduce((s, c) => s + c.tipCents, 0),
      openChecks: checks.filter((c) => c.status === 'open').length,
      lastSyncAt,
    };
  }

  @UseGuards(AuthGuard)
  @RequireSubscription('paid')
  @Get('sales/summary')
  async getSalesSummaryDashboard(@CurrentUser() user: AuthUser, @Query() query: SalesWindowQueryDto) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;

    const windowDays = Math.min(Math.max(1, Math.round(query.windowDays ?? 7)), 90);
    const start = query.startTs ?? dayBounds(-windowDays + 1).start;
    const end = query.endTs !== undefined ? query.endTs + 1 : dayBounds(1).start;

    const checks = await this.prisma.posCheck.findMany({
      where: {
        venueId,
        openedAt: { gte: new Date(start), lt: new Date(end) },
      },
      orderBy: { openedAt: 'asc' },
      take: 5000,
    });

    const acc = { salesCents: 0, taxCents: 0, tipCents: 0, discountCents: 0, compCents: 0, promoCents: 0, checkCount: 0, coverCount: 0 };
    const byDay = new Map<string, { salesCents: number; checkCount: number; coverCount: number }>();
    const byTender = new Map<string, { salesCents: number; checkCount: number }>();
    const byRevenueCenter = new Map<string, { salesCents: number; checkCount: number; coverCount: number }>();
    let totalTimeMins = 0;
    let timedChecks = 0;

    for (const check of checks) {
      if (check.status === 'void') continue;
      accumulateCheck(acc, check);
      if (check.closedAt) {
        totalTimeMins += (check.closedAt.getTime() - check.openedAt.getTime()) / 60_000;
        timedChecks += 1;
      }

      const date = isoDate(check.openedAt.getTime());
      const dayRow = byDay.get(date) ?? { salesCents: 0, checkCount: 0, coverCount: 0 };
      dayRow.salesCents += check.totalCents;
      dayRow.checkCount += 1;
      dayRow.coverCount += check.guestCount ?? 1;
      byDay.set(date, dayRow);

      const tender = (check as any).tenderType?.trim() || 'Unknown';
      const tenderRow = byTender.get(tender) ?? { salesCents: 0, checkCount: 0 };
      tenderRow.salesCents += check.totalCents;
      tenderRow.checkCount += 1;
      byTender.set(tender, tenderRow);

      const revenueCenter = (check as any).revenueCenter?.trim() || 'Default';
      const revenueCenterRow = byRevenueCenter.get(revenueCenter) ?? { salesCents: 0, checkCount: 0, coverCount: 0 };
      revenueCenterRow.salesCents += check.totalCents;
      revenueCenterRow.checkCount += 1;
      revenueCenterRow.coverCount += check.guestCount ?? 1;
      byRevenueCenter.set(revenueCenter, revenueCenterRow);
    }

    return {
      summary: {
        ...acc,
        avgCheckCents: acc.checkCount ? Math.round(acc.salesCents / acc.checkCount) : 0,
        avgCheckTimeMins: timedChecks ? Math.round(totalTimeMins / timedChecks) : null,
      },
      byDay: Array.from(byDay.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({ date, ...value })),
      byTender: Array.from(byTender.entries())
        .map(([tenderType, value]) => ({ tenderType, ...value }))
        .sort((a, b) => b.salesCents - a.salesCents),
      byRevenueCenter: Array.from(byRevenueCenter.entries())
        .map(([revenueCenter, value]) => ({ revenueCenter, ...value }))
        .sort((a, b) => b.salesCents - a.salesCents),
    };
  }

  @UseGuards(AuthGuard)
  @RequireSubscription('paid')
  @Get('sales/by-server')
  async getSalesByServer(@CurrentUser() user: AuthUser, @Query() query: SalesWindowQueryDto) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;

    const windowDays = Math.min(Math.max(1, Math.round(query.windowDays ?? 7)), 90);
    const start = query.startTs ?? dayBounds(-windowDays + 1).start;
    const end = query.endTs !== undefined ? query.endTs + 1 : dayBounds(1).start;

    const checks = await this.prisma.posCheck.findMany({
      where: {
        venueId,
        openedAt: { gte: new Date(start), lt: new Date(end) },
      },
      orderBy: { openedAt: 'asc' },
      take: 5000,
    });

    type Row = { salesCents: number; tipCents: number; discountCents: number; compCents: number; checkCount: number; coverCount: number };
    const byServer = new Map<string, Row>();
    for (const c of checks) {
      if (c.status === 'void') continue;
      const name = c.serverName?.trim() || 'Unknown';
      const row = byServer.get(name) ?? { salesCents: 0, tipCents: 0, discountCents: 0, compCents: 0, checkCount: 0, coverCount: 0 };
      row.salesCents += c.totalCents;
      row.tipCents += c.tipCents;
      row.discountCents += c.discountCents ?? 0;
      row.compCents += c.compCents ?? 0;
      row.checkCount += 1;
      row.coverCount += c.guestCount ?? 1;
      byServer.set(name, row);
    }

    return Array.from(byServer.entries())
      .map(([serverName, r]) => ({ serverName, ...r, avgCheckCents: r.checkCount ? Math.round(r.salesCents / r.checkCount) : 0 }))
      .sort((a, b) => b.salesCents - a.salesCents);
  }

  @UseGuards(AuthGuard)
  @RequireSubscription('paid')
  @Get('sales/top-items')
  async getTopMenuItems(@CurrentUser() user: AuthUser, @Query() query: TopItemsQueryDto) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;

    const windowDays = Math.min(Math.max(1, Math.round(query.windowDays ?? 7)), 90);
    const cap = Math.min(query.limit ?? 20, 50);
    const start = query.startTs ?? dayBounds(-windowDays + 1).start;
    const end = query.endTs !== undefined ? query.endTs + 1 : dayBounds(1).start;

    const checks = await this.prisma.posCheck.findMany({
      where: {
        venueId,
        openedAt: { gte: new Date(start), lt: new Date(end) },
      },
      orderBy: { openedAt: 'asc' },
      take: 5000,
    });

    const byItem = new Map<string, { name: string; category: string | null; quantity: number; salesCents: number }>();
    for (const c of checks) {
      if (c.status === 'void' || !c.menuItems) continue;
      const items = c.menuItems as any[];
      for (const it of items) {
        const key = String(it.name).toLowerCase();
        const row = byItem.get(key) ?? { name: it.name, category: it.category ?? null, quantity: 0, salesCents: 0 };
        row.quantity += it.quantity;
        row.salesCents += it.priceCents * it.quantity;
        byItem.set(key, row);
      }
    }

    return Array.from(byItem.values())
      .sort((a, b) => b.salesCents - a.salesCents)
      .slice(0, cap);
  }

  @UseGuards(AuthGuard)
  @RequireSubscription('paid')
  @Get('labor')
  async getLaborSummary(@CurrentUser() user: AuthUser, @Query() query: SalesWindowQueryDto) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;

    const windowDays = Math.min(Math.max(1, Math.round(query.windowDays ?? 7)), 90);
    const rawStart = query.startTs ?? dayBounds(-windowDays + 1).start;
    const rawEnd = query.endTs ?? dayBounds(0).start;

    const dates: string[] = [];
    for (let cur = rawStart; cur <= rawEnd; cur += 86_400_000) {
      dates.push(isoDate(cur));
    }

    if (dates.length === 0) {
      return { totalRegularMins: 0, totalOvertimeMins: 0, totalPayCents: 0, totalTipsCents: 0, byEmployee: [] };
    }

    const dateSet = new Set(dates);
    const punches = await this.prisma.posLaborPunch.findMany({
      where: {
        venueId,
        businessDate: { gte: dates[0], lte: dates[dates.length - 1] },
      },
      orderBy: { businessDate: 'asc' },
      take: 2000,
    });

    type EmpRow = { employeeName: string; jobTitle: string | null; regularMins: number; overtimeMins: number; payCents: number; tipsCents: number };
    const byEmp = new Map<string, EmpRow>();
    let totalRegularMins = 0, totalOvertimeMins = 0, totalPayCents = 0, totalTipsCents = 0;

    for (const p of punches) {
      if (!dateSet.has(p.businessDate)) continue;
      const row = byEmp.get(p.externalEmployeeId) ?? {
        employeeName: p.employeeName,
        jobTitle: p.jobTitle ?? null,
        regularMins: 0,
        overtimeMins: 0,
        payCents: 0,
        tipsCents: 0,
      };
      const reg = p.regularMinutes ?? 0;
      const ot = p.overtimeMinutes ?? 0;
      const pay = p.totalPayCents ?? 0;
      const tips = (p.tipsCents ?? 0) + (p.declaredTipsCents ?? 0);
      row.regularMins += reg;
      row.overtimeMins += ot;
      row.payCents += pay;
      row.tipsCents += tips;
      totalRegularMins += reg;
      totalOvertimeMins += ot;
      totalPayCents += pay;
      totalTipsCents += tips;
      byEmp.set(p.externalEmployeeId, row);
    }

    return {
      totalRegularMins,
      totalOvertimeMins,
      totalPayCents,
      totalTipsCents,
      byEmployee: Array.from(byEmp.values()).sort((a, b) => b.payCents - a.payCents),
    };
  }

  @UseGuards(AuthGuard)
  @RequireSubscription('paid')
  @Post('connections')
  async upsertPosConnection(@CurrentUser() user: AuthUser, @Body() body: UpsertPosConnectionDto) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;

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

  private async requireManagerProfile(user: AuthUser) {
    const profile = await this.prisma.profile.findFirst({
      where: { userId: user.sub },
      include: { venue: true },
    });
    if (!profile?.venueId) throw new Error('Profile is not initialized');
    if (!isAdminRole(profile.role)) throw new Error('Not authorized');
    return profile;
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
