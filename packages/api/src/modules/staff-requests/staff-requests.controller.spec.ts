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

  it('opens an overnight shift whose spill overlaps the first unavailable day', async () => {
    const now = new Date('2026-08-24T12:00:00.000Z');
    const request = {
      id: 'request-overnight', venueId: 'venue-1', profileId: 'profile-1',
      kind: 'time_off', status: 'pending', title: 'Unavailable', details: '',
      requestedForDate: '2026-08-24', requestedShiftId: null,
      requestedRangeStart: null, requestedRangeEnd: null, availability: null,
      reviewerId: null, reviewedAt: null, responseNotes: null,
      createdAt: now, updatedAt: now,
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      staffRequest: {
        findUnique: vi.fn().mockResolvedValue(request),
        update: vi.fn().mockResolvedValue({ ...request, status: 'approved' }),
      },
      profile: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'manager-1', fullName: 'Manager' }) },
      scheduleShift: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'sat-night', weekStart: '2026-08-23', dayIndex: 0, startMinutes: 1320, endMinutes: 1560 },
        ]),
        updateMany,
      },
    };
    const controller = new StaffRequestsController(
      { $transaction: vi.fn((callback) => callback(tx)) } as any,
      { notifyProfile: vi.fn().mockResolvedValue(undefined) } as any,
      { sendToProfile: vi.fn().mockResolvedValue(undefined) } as any,
    );

    await controller.reviewStaffRequest(
      { venueId: 'venue-1', profileId: 'manager-1', role: 'manager' } as any,
      request.id,
      { status: 'approved' } as any,
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['sat-night'] } },
      data: { profileId: null, status: 'open' },
    });
  });

  it('records a manager-approved missing punch without fabricated GPS coordinates', async () => {
    const now = new Date('2026-08-24T12:00:00.000Z');
    const request = {
      id: 'request-correction', venueId: 'venue-1', profileId: 'profile-1',
      kind: 'time_correction', status: 'pending', title: 'Missing punch', details: '',
      requestedForDate: null, requestedShiftId: null, requestedRangeStart: null,
      requestedRangeEnd: null,
      availability: {
        clockInAt: '2026-08-24T14:00:00.000Z',
        clockOutAt: '2026-08-24T22:00:00.000Z',
      },
      reviewerId: null, reviewedAt: null, responseNotes: null,
      createdAt: now, updatedAt: now,
    };
    const create = vi.fn().mockResolvedValue({ id: 'entry-correction' });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      staffRequest: {
        findUnique: vi.fn().mockResolvedValue(request),
        update: vi.fn().mockResolvedValue({ ...request, status: 'approved' }),
      },
      profile: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'manager-1', fullName: 'Manager' }) },
      venue: { findUnique: vi.fn().mockResolvedValue({ timezone: 'UTC' }) },
      timeEntry: { findFirst: vi.fn().mockResolvedValue(null), create },
    };
    const controller = new StaffRequestsController(
      { $transaction: vi.fn((callback) => callback(tx)) } as any,
      { notifyProfile: vi.fn().mockResolvedValue(undefined) } as any,
      { sendToProfile: vi.fn().mockResolvedValue(undefined) } as any,
    );

    await controller.reviewStaffRequest(
      { venueId: 'venue-1', profileId: 'manager-1', role: 'manager' } as any,
      request.id,
      { status: 'approved' } as any,
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clockInLat: null, clockInLng: null, clockInAccuracyM: null, clockInMocked: null,
        clockOutLat: null, clockOutLng: null, clockOutAccuracyM: null, clockOutMocked: null,
      }),
    });
  });

  it('rejects a manager approving their own time correction', async () => {
    const now = new Date('2026-08-24T12:00:00.000Z');
    const request = {
      id: 'request-self', venueId: 'venue-1', profileId: 'manager-1',
      kind: 'time_correction', status: 'pending', title: 'Missing punch', details: '',
      requestedForDate: null, requestedShiftId: null, requestedRangeStart: null,
      requestedRangeEnd: null, availability: {}, reviewerId: null, reviewedAt: null,
      responseNotes: null, createdAt: now, updatedAt: now,
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      staffRequest: { findUnique: vi.fn().mockResolvedValue(request), update: vi.fn() },
    };
    const controller = new StaffRequestsController(
      { $transaction: vi.fn((callback) => callback(tx)) } as any,
      { notifyProfile: vi.fn() } as any,
      { sendToProfile: vi.fn() } as any,
    );

    await expect(controller.reviewStaffRequest(
      { venueId: 'venue-1', profileId: 'manager-1', role: 'manager' } as any,
      request.id,
      { status: 'approved' } as any,
    )).rejects.toBeInstanceOf(ForbiddenException);
  });
});
