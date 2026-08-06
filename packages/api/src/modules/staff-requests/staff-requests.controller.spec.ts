import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StaffRequestsController } from './staff-requests.controller';

describe('StaffRequestsController', () => {
  it('scopes a staff member to only their own venue requests', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const controller = new StaffRequestsController({ staffRequest: { findMany } } as any, {} as any, {} as any);

    await expect(controller.listStaffRequests({
      venueId: 'venue-1',
      profileId: 'profile-1',
      role: 'staff',
    } as any)).resolves.toEqual([]);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { venueId: 'venue-1', profileId: 'profile-1' },
    }));
  });

  it('returns no data without venue scope and rejects mutations', async () => {
    const controller = new StaffRequestsController({} as any, {} as any, {} as any);
    await expect(controller.listStaffRequests(undefined)).resolves.toEqual([]);
    await expect(controller.createStaffRequest(undefined, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('opens only the dated shifts covered by an approved unavailable-day request', async () => {
    const now = new Date('2026-08-05T12:00:00.000Z');
    const request = {
      id: 'request-1',
      venueId: 'venue-1',
      profileId: 'profile-1',
      kind: 'time_off',
      status: 'pending',
      title: 'Unavailable',
      details: 'Family event',
      requestedForDate: null,
      requestedShiftId: null,
      requestedRangeStart: '2026-08-04',
      requestedRangeEnd: '2026-08-05',
      availability: null,
      reviewerId: null,
      reviewedAt: null,
      responseNotes: null,
      createdAt: now,
      updatedAt: now,
    };
    const updated = { ...request, status: 'approved', reviewerId: 'manager-1', reviewedAt: now };
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      staffRequest: {
        findUnique: vi.fn().mockResolvedValue(request),
        update: vi.fn().mockResolvedValue(updated),
      },
      profile: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'manager-1', fullName: 'Manager' }) },
      scheduleShift: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'before', weekStart: '2026-08-02', dayIndex: 1 },
          { id: 'covered-1', weekStart: '2026-08-02', dayIndex: 2 },
          { id: 'covered-2', weekStart: '2026-08-02', dayIndex: 3 },
          { id: 'after', weekStart: '2026-08-02', dayIndex: 4 },
        ]),
        updateMany,
      },
    };
    const prisma = { $transaction: vi.fn((callback) => callback(tx)) };
    const notifications = { notifyProfile: vi.fn().mockResolvedValue(undefined) };
    const email = { sendToProfile: vi.fn().mockResolvedValue(undefined) };
    const controller = new StaffRequestsController(prisma as any, notifications as any, email as any);

    await controller.reviewStaffRequest({
      venueId: 'venue-1',
      profileId: 'manager-1',
      role: 'manager',
    } as any, 'request-1', { status: 'approved' } as any);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['covered-1', 'covered-2'] } },
      data: { profileId: null, status: 'open' },
    });
  });
});
