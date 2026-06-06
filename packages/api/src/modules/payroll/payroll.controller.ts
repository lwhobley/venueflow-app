import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

class RecordPayrollExportDto {
  @IsString()
  provider!: string;

  @IsString()
  periodStart!: string;

  @IsString()
  periodEnd!: string;

  @IsInt()
  @IsOptional()
  rowCount?: number;

  @IsNumber()
  @IsOptional()
  totalHours?: number;
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function parseDateParam(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(`${value}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? fallback : d;
}

async function buildPayrollRows(
  prisma: PrismaService,
  venueId: string,
  periodStart: Date,
  periodEnd: Date,
) {
  const [staff, entries] = await Promise.all([
    prisma.profile.findMany({
      where: { venueId },
      orderBy: { fullName: 'asc' },
    }),
    prisma.timeEntry.findMany({
      where: {
        venueId,
        clockInAt: { lte: periodEnd },
        clockOutAt: { not: null },
      },
      take: 2000,
    }),
  ]);

  return staff.map((member) => {
    const memberEntries = entries.filter((e) => {
      if (e.profileId !== member.id || !e.clockOutAt) return false;
      const end = e.clockOutAt.getTime();
      return end >= periodStart.getTime() && e.clockInAt.getTime() <= periodEnd.getTime();
    });

    const totalHours = memberEntries.reduce((sum, e) => {
      if (!e.clockOutAt) return sum;
      const start = Math.max(e.clockInAt.getTime(), periodStart.getTime());
      const end = Math.min(e.clockOutAt.getTime(), periodEnd.getTime());
      return sum + Math.max(0, end - start) / 3600000;
    }, 0);

    return {
      profileId: member.id,
      employeeName: member.fullName,
      role: member.role,
      jobTitle: member.jobTitle,
      totalHours: Math.round(totalHours * 100) / 100,
    };
  });
}

@Controller('v1/payroll')
export class PayrollController {
  constructor(private readonly prisma: PrismaService) {}

  private requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
    if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
  }

  @RequireSubscription('paid')
  @Get('summary')
  async getPayrollSummary(
    @VenueScope() scope: Scope,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    this.requireManager(scope);
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const periodStart = parseDateParam(startDate, twoWeeksAgo);
    const periodEnd = parseDateParam(endDate, now);

    const rows = await buildPayrollRows(this.prisma, scope.venueId, periodStart, periodEnd);
    const totalHours = Math.round(rows.reduce((sum, r) => sum + r.totalHours, 0) * 100) / 100;

    return {
      byEmployee: rows,
      totals: {
        totalHours,
        employeeCount: rows.filter((r) => r.totalHours > 0).length,
        periodStart: periodStart.getTime(),
        periodEnd: periodEnd.getTime(),
      },
    };
  }

  @RequireSubscription('paid')
  @Get('export-csv')
  async exportPayrollCsv(
    @VenueScope() scope: Scope,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    this.requireManager(scope);
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const periodStart = parseDateParam(startDate, twoWeeksAgo);
    const periodEnd = parseDateParam(endDate, now);

    const rows = await buildPayrollRows(this.prisma, scope.venueId, periodStart, periodEnd);
    const headers = ['Employee', 'Role', 'Regular Hours', 'Total Hours', 'Start Date', 'End Date'];
    const csvRows = [headers.map(csvCell).join(',')];
    for (const row of rows) {
      csvRows.push([
        csvCell(row.employeeName),
        csvCell(row.role),
        csvCell(row.totalHours),
        csvCell(row.totalHours),
        csvCell(periodStart.toISOString().slice(0, 10)),
        csvCell(periodEnd.toISOString().slice(0, 10)),
      ].join(','));
    }
    return csvRows.join('\n');
  }

  @RequireSubscription('paid')
  @Post('record-export')
  async recordPayrollExport(@VenueScope() scope: Scope, @Body() body: RecordPayrollExportDto) {
    this.requireManager(scope);
    const periodStart = new Date(body.periodStart);
    const periodEnd = new Date(body.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
      throw new BadRequestException('Invalid period dates');
    }
    const record = await this.prisma.payrollExport.create({
      data: {
        venueId: scope.venueId,
        provider: body.provider,
        periodStart,
        periodEnd,
        rowCount: body.rowCount ?? 0,
        totalHours: body.totalHours ?? 0,
        createdBy: scope.profileId,
      },
    });
    return { id: record.id };
  }
}
