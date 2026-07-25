import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { PayrollController } from './payroll.controller';

function makeController() {
  const prisma = {
    profile: { findMany: vi.fn().mockResolvedValue([]) },
    timeEntry: { findMany: vi.fn().mockResolvedValue([]) },
    payrollExport: { create: vi.fn().mockResolvedValue({ id: 'export-1' }) },
  } as any;
  const controller = new PayrollController(prisma);
  return { controller, prisma };
}

const managerScope = { venueId: 'venue-1', profileId: 'manager-1', role: 'manager', allAccess: false } as any;
const staffScope = { venueId: 'venue-1', profileId: 'staff-1', role: 'staff', allAccess: false } as any;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PayrollController', () => {
  describe('authorization', () => {
    it('rejects non-manager roles from the summary endpoint', async () => {
      const { controller } = makeController();
      await expect(controller.getPayrollSummary(staffScope)).rejects.toThrow(ForbiddenException);
    });

    it('rejects a missing scope from the export-csv endpoint', async () => {
      const { controller } = makeController();
      await expect(controller.exportPayrollCsv(undefined as any)).rejects.toThrow(ForbiddenException);
    });

    it('rejects non-manager roles from record-export', async () => {
      const { controller } = makeController();
      await expect(controller.recordPayrollExport(staffScope, {
        provider: 'gusto',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-14',
      })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getPayrollSummary', () => {
    it('computes regular hours per employee within the requested period', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findMany.mockResolvedValue([
        { id: 'staff-1', fullName: 'Alex Server', role: 'staff', jobTitle: 'Server' },
      ]);
      prisma.timeEntry.findMany.mockResolvedValue([
        {
          profileId: 'staff-1',
          profileFullName: 'Alex Server',
          clockInAt: new Date('2026-07-05T09:00:00.000Z'),
          clockOutAt: new Date('2026-07-05T17:00:00.000Z'),
          breaks: [],
        },
      ]);

      const result = await controller.getPayrollSummary(managerScope, '2026-07-01', '2026-07-07');

      expect(result.byEmployee).toEqual([
        expect.objectContaining({ profileId: 'staff-1', employeeName: 'Alex Server', regularHours: 8, totalHours: 8 }),
      ]);
      expect(result.totals.totalHours).toBe(8);
      expect(result.totals.employeeCount).toBe(1);
    });

    it('subtracts unpaid break time from worked hours', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findMany.mockResolvedValue([
        { id: 'staff-1', fullName: 'Alex Server', role: 'staff', jobTitle: 'Server' },
      ]);
      const clockIn = new Date('2026-07-05T09:00:00.000Z');
      const clockOut = new Date('2026-07-05T17:00:00.000Z');
      prisma.timeEntry.findMany.mockResolvedValue([
        {
          profileId: 'staff-1',
          profileFullName: 'Alex Server',
          clockInAt: clockIn,
          clockOutAt: clockOut,
          breaks: [{ type: 'unpaid', startAt: clockIn.getTime() + 3600000, endAt: clockIn.getTime() + 5400000 }],
        },
      ]);

      const result = await controller.getPayrollSummary(managerScope, '2026-07-01', '2026-07-07');

      expect(result.byEmployee[0].regularHours).toBe(7.5);
    });

    it('groups deleted-account wage records by their snapshotted name', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findMany.mockResolvedValue([]);
      prisma.timeEntry.findMany.mockResolvedValue([
        {
          profileId: null,
          profileFullName: 'Former Employee',
          clockInAt: new Date('2026-07-05T09:00:00.000Z'),
          clockOutAt: new Date('2026-07-05T13:00:00.000Z'),
          breaks: [],
        },
      ]);

      const result = await controller.getPayrollSummary(managerScope, '2026-07-01', '2026-07-07');

      expect(result.byEmployee).toEqual([
        expect.objectContaining({ profileId: null, employeeName: 'Former Employee', jobTitle: 'Former staff', totalHours: 4 }),
      ]);
    });

    it('defaults to a trailing 14-day period when no dates are given', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-15T00:00:00.000Z'));
      const { controller, prisma } = makeController();

      const result = await controller.getPayrollSummary(managerScope, undefined, undefined);

      const expectedStart = new Date('2026-07-01T00:00:00.000Z').getTime();
      expect(result.totals.periodStart).toBe(expectedStart);
      expect(prisma.timeEntry.findMany).toHaveBeenCalled();
    });
  });

  describe('exportPayrollCsv', () => {
    it('renders a CSV with header and one row per employee', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findMany.mockResolvedValue([
        { id: 'staff-1', fullName: 'Alex Server', role: 'staff', jobTitle: 'Server' },
      ]);
      prisma.timeEntry.findMany.mockResolvedValue([
        {
          profileId: 'staff-1',
          profileFullName: 'Alex Server',
          clockInAt: new Date('2026-07-05T09:00:00.000Z'),
          clockOutAt: new Date('2026-07-05T17:00:00.000Z'),
          breaks: [],
        },
      ]);

      const csv = await controller.exportPayrollCsv(managerScope, '2026-07-01', '2026-07-07');
      const lines = csv.split('\n');

      expect(lines[0]).toBe('"Employee","Role","Regular Hours","Total Hours","Start Date","End Date"');
      expect(lines[1]).toContain('"Alex Server"');
      expect(lines[1]).toContain('"8"');
    });

    it('neutralizes formula-injection payloads in employee names', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findMany.mockResolvedValue([
        { id: 'staff-1', fullName: '=SUM(A1:A9)', role: 'staff', jobTitle: 'Server' },
      ]);
      prisma.timeEntry.findMany.mockResolvedValue([]);

      const csv = await controller.exportPayrollCsv(managerScope, '2026-07-01', '2026-07-07');

      expect(csv).toContain("\"'=SUM(A1:A9)\"");
    });
  });

  describe('recordPayrollExport', () => {
    it('rejects invalid period dates', async () => {
      const { controller } = makeController();
      await expect(controller.recordPayrollExport(managerScope, {
        provider: 'gusto',
        periodStart: 'not-a-date',
        periodEnd: '2026-07-14',
      })).rejects.toThrow('Invalid period dates');
    });

    it('persists a payroll export record scoped to the venue', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.recordPayrollExport(managerScope, {
        provider: 'gusto',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-14',
        rowCount: 12,
        totalHours: 240,
      });

      expect(prisma.payrollExport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          venueId: 'venue-1',
          provider: 'gusto',
          rowCount: 12,
          totalHours: 240,
          createdBy: 'manager-1',
        }),
      });
      expect(result).toEqual({ id: 'export-1' });
    });

    it('defaults rowCount and totalHours to 0 when omitted', async () => {
      const { controller, prisma } = makeController();

      await controller.recordPayrollExport(managerScope, {
        provider: 'adp',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-14',
      });

      expect(prisma.payrollExport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ rowCount: 0, totalHours: 0 }),
      });
    });
  });
});
