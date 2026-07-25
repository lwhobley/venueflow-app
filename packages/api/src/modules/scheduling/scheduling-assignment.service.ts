import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ShiftStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { withSerializableRetry } from '../../common/tx-retry';

@Injectable()
export class SchedulingAssignmentService {
  private readonly logger = new Logger(SchedulingAssignmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createShift(args: {
    venueId: string;
    profileId?: string;
    dayIndex: number;
    startMinutes: number;
    endMinutes: number;
    jobTitle: string;
    station: string;
    notes?: string;
  }) {
    if (args.profileId) {
      await this.assertVenueMember(args.venueId, args.profileId);
    }

    return withSerializableRetry(this.prisma, async (tx) => {
      if (args.profileId) {
        await this.lockAssignmentKeys(tx, [
          {
            venueId: args.venueId,
            profileId: args.profileId,
            dayIndex: args.dayIndex,
          },
        ]);
        await this.assertNoDoubleBookTx(
          tx,
          args.venueId,
          args.profileId,
          args.dayIndex,
          args.startMinutes,
          args.endMinutes,
        );
      }

      const created = await tx.scheduleShift.create({
        data: {
          venueId: args.venueId,
          profileId: args.profileId,
          dayIndex: args.dayIndex,
          startMinutes: args.startMinutes,
          endMinutes: args.endMinutes,
          jobTitle: args.jobTitle.trim() || 'Staff',
          station: args.station.trim() || 'Floor',
          notes: args.notes?.trim() || null,
          status: args.profileId ? 'scheduled' : 'open',
        },
      });
      await tx.venue.update({
        where: { id: args.venueId },
        data: { scheduleUpdatedAfterPublishAt: new Date() },
      });
      return created;
    });
  }

  async updateShift(args: {
    venueId: string;
    shiftId: string;
    dayIndex: number;
    startMinutes: number;
    endMinutes: number;
    jobTitle: string;
    station: string;
    notes?: string;
  }) {
    const shift = await this.getVenueShift(args.venueId, args.shiftId);
    let currentProfileId = shift.profileId;

    await withSerializableRetry(this.prisma, async (tx) => {
      // Re-read inside the transaction: the shift's assignment may have
      // changed (e.g. a concurrent assignShift/reviewSwap) since the initial
      // read above, and the double-book check below must validate against
      // whoever actually holds the shift right now, not a stale snapshot.
      const current = await tx.scheduleShift.findFirst({
        where: { id: shift.id, venueId: args.venueId },
      });
      if (!current) throw new NotFoundException('Shift not found');
      currentProfileId = current.profileId;

      if (current.profileId) {
        await this.lockAssignmentKeys(tx, [
          {
            venueId: args.venueId,
            profileId: current.profileId,
            dayIndex: args.dayIndex,
          },
        ]);
        await this.assertNoDoubleBookTx(
          tx,
          args.venueId,
          current.profileId,
          args.dayIndex,
          args.startMinutes,
          args.endMinutes,
          current.id,
        );
      }

      await tx.scheduleShift.update({
        where: { id: current.id },
        data: {
          dayIndex: args.dayIndex,
          startMinutes: args.startMinutes,
          endMinutes: args.endMinutes,
          jobTitle: args.jobTitle.trim() || 'Staff',
          station: args.station.trim() || 'Floor',
          notes: args.notes?.trim() || null,
        },
      });
      await tx.venue.update({
        where: { id: args.venueId },
        data: { scheduleUpdatedAfterPublishAt: new Date() },
      });
    });

    // dayIndex/startMinutes/endMinutes/station intentionally reflect the
    // pre-update values (the controller uses them as the "before" side of
    // the edit-notification email diff); profileId reflects the up-to-date
    // assignee so that email goes to whoever actually holds the shift.
    return { ...shift, profileId: currentProfileId };
  }

  async assignShift(args: {
    venueId: string;
    shiftId: string;
    profileId?: string;
  }) {
    const shift = await this.getVenueShift(args.venueId, args.shiftId);

    if (!args.profileId) {
      await this.prisma.scheduleShift.update({
        where: { id: shift.id },
        data: { profileId: null, status: 'open' },
      });
      await this.markScheduleEdited(args.venueId);
      return { shift, nextProfileId: null };
    }

    await this.assertVenueMember(args.venueId, args.profileId);
    await withSerializableRetry(this.prisma, async (tx) => {
      const current = await tx.scheduleShift.findFirst({
        where: { id: shift.id, venueId: args.venueId },
      });
      if (!current) throw new NotFoundException('Shift not found');

      await this.lockAssignmentKeys(tx, [
        {
          venueId: args.venueId,
          profileId: args.profileId!,
          dayIndex: current.dayIndex,
        },
      ]);
      await this.assertNoDoubleBookTx(
        tx,
        args.venueId,
        args.profileId!,
        current.dayIndex,
        current.startMinutes,
        current.endMinutes,
        current.id,
      );
      await tx.scheduleShift.update({
        where: { id: current.id },
        data: { profileId: args.profileId, status: 'scheduled' },
      });
      await tx.venue.update({
        where: { id: args.venueId },
        data: { scheduleUpdatedAfterPublishAt: new Date() },
      });
    });

    return { shift, nextProfileId: args.profileId };
  }

  async deleteShift(args: {
    venueId: string;
    shiftId: string;
  }) {
    const shift = await this.getVenueShift(args.venueId, args.shiftId);
    await this.prisma.scheduleShift.delete({ where: { id: shift.id } });
    await this.markScheduleEdited(args.venueId);
    return shift;
  }

  async restoreShifts(args: {
    venueId: string;
    shifts: Array<{
      dayIndex: number;
      startMinutes: number;
      endMinutes: number;
      jobTitle: string;
      station: string;
      status: ShiftStatus;
      profileId?: string | null;
      notes?: string | null;
    }>;
  }) {
    const referencedIds = Array.from(
      new Set(args.shifts.map((shift) => shift.profileId).filter((id): id is string => Boolean(id))),
    );
    const members = referencedIds.length
      ? await this.prisma.profile.findMany({
          where: {
            id: { in: referencedIds },
            venueId: args.venueId,
            OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
          },
          select: { id: true },
        })
      : [];
    const memberIds = new Set(members.map((member) => member.id));

    const creates = args.shifts.map((shift) => {
      const profileId =
        shift.profileId && memberIds.has(shift.profileId) ? shift.profileId : undefined;

      return this.prisma.scheduleShift.create({
        data: {
          venueId: args.venueId,
          profileId,
          dayIndex: shift.dayIndex,
          startMinutes: shift.startMinutes,
          endMinutes: shift.endMinutes,
          jobTitle: shift.jobTitle,
          station: shift.station,
          status: profileId ? shift.status : 'open',
          notes: shift.notes,
        },
      });
    });

    await this.prisma.$transaction(creates);
    await this.markScheduleEdited(args.venueId);
    return { restored: creates.length };
  }

  async copyDayShifts(args: {
    venueId: string;
    fromDay: number;
    toDays: number[];
  }) {
    const source = await this.prisma.scheduleShift.findMany({
      where: { venueId: args.venueId, dayIndex: args.fromDay },
    });
    const creates = args.toDays
      .filter((day) => day !== args.fromDay)
      .flatMap((day) =>
        source.map((shift) =>
          this.prisma.scheduleShift.create({
            data: {
              venueId: args.venueId,
              dayIndex: day,
              startMinutes: shift.startMinutes,
              endMinutes: shift.endMinutes,
              jobTitle: shift.jobTitle,
              station: shift.station,
              status: 'open',
            },
          }),
        ),
      );
    await this.prisma.$transaction(creates);
    await this.markScheduleEdited(args.venueId);
    return { added: creates.length };
  }

  async clearWeek(args: {
    venueId: string;
  }) {
    const shifts = await this.prisma.scheduleShift.findMany({ where: { venueId: args.venueId } });
    const snapshots = shifts.map((shift) => ({
      dayIndex: shift.dayIndex,
      startMinutes: shift.startMinutes,
      endMinutes: shift.endMinutes,
      jobTitle: shift.jobTitle,
      station: shift.station,
      status: shift.status,
      profileId: shift.profileId,
      notes: shift.notes,
    }));
    await this.prisma.scheduleShift.deleteMany({ where: { venueId: args.venueId } });
    await this.markScheduleEdited(args.venueId);
    return { removed: shifts.length, shifts: snapshots };
  }

  async applyTemplate(args: {
    venueId: string;
    replace: boolean;
    slots: Array<{
      dayIndex: number;
      startMinutes: number;
      endMinutes: number;
      jobTitle: string;
      station: string;
      notes?: string | null;
    }>;
  }) {
    const creates = args.slots.map((slot) =>
      this.prisma.scheduleShift.create({
        data: {
          venueId: args.venueId,
          dayIndex: slot.dayIndex,
          startMinutes: slot.startMinutes,
          endMinutes: slot.endMinutes,
          jobTitle: slot.jobTitle,
          station: slot.station,
          notes: slot.notes?.trim() || null,
          status: 'open',
        },
      }),
    );
    await this.prisma.$transaction([
      ...(args.replace ? [this.prisma.scheduleShift.deleteMany({ where: { venueId: args.venueId } })] : []),
      ...creates,
    ]);
    await this.markScheduleEdited(args.venueId);
    return { added: args.slots.length };
  }

  async proposeSwap(args: {
    venueId: string;
    requesterProfileId: string;
    requesterShiftId: string;
    targetProfileId: string;
    targetShiftId?: string;
    note?: string;
  }) {
    const requesterShift = await this.getVenueShift(args.venueId, args.requesterShiftId);
    if (requesterShift.profileId !== args.requesterProfileId) {
      throw new BadRequestException('That is not your shift');
    }

    const target = await this.assertVenueMember(args.venueId, args.targetProfileId);
    if (target.id === args.requesterProfileId) {
      throw new BadRequestException('Choose a teammate');
    }

    if (args.targetShiftId) {
      const targetShift = await this.getVenueShift(args.venueId, args.targetShiftId);
      if (targetShift.profileId !== target.id) {
        throw new BadRequestException("That is not the teammate's shift");
      }
    }

    const swap = await this.prisma.shiftSwap.create({
      data: {
        venueId: args.venueId,
        requesterProfileId: args.requesterProfileId,
        requesterShiftId: requesterShift.id,
        targetProfileId: target.id,
        targetShiftId: args.targetShiftId,
        status: 'proposed',
        note: args.note?.trim() || null,
      },
    });

    return { swap, requesterShift, target };
  }

  async respondToSwap(args: {
    venueId: string;
    swapId: string;
    profileId: string;
    accept: boolean;
  }) {
    const swap = await this.prisma.shiftSwap.findFirst({
      where: { id: args.swapId, venueId: args.venueId },
    });
    if (!swap || swap.targetProfileId !== args.profileId) {
      throw new BadRequestException('Not authorized');
    }
    if (swap.status !== 'proposed') {
      throw new BadRequestException('This swap is no longer open');
    }

    const responded = await this.prisma.shiftSwap.updateMany({
      where: { id: swap.id, status: 'proposed' },
      data: { status: args.accept ? 'accepted' : 'declined' },
    });
    if (responded.count === 0) {
      throw new BadRequestException('This swap is no longer open');
    }

    return swap;
  }

  async reviewSwap(args: {
    venueId: string;
    swapId: string;
    approve: boolean;
  }) {
    const swap = await this.prisma.shiftSwap.findFirst({
      where: { id: args.swapId, venueId: args.venueId },
    });
    if (!swap) throw new NotFoundException('Swap not found');
    if (!['accepted', 'proposed'].includes(swap.status)) {
      throw new BadRequestException('Swap is not pending');
    }

    if (args.approve) {
      await withSerializableRetry(this.prisma, async (tx) => {
        const requesterShift = await tx.scheduleShift.findFirst({
          where: { id: swap.requesterShiftId, venueId: args.venueId },
        });
        const targetShift = swap.targetShiftId
          ? await tx.scheduleShift.findFirst({
              where: { id: swap.targetShiftId, venueId: args.venueId },
            })
          : null;
        if (!requesterShift || (swap.targetShiftId && !targetShift)) {
          throw new NotFoundException('Shift not found');
        }

        await this.lockAssignmentKeys(tx, [
          {
            venueId: args.venueId,
            profileId: swap.targetProfileId,
            dayIndex: requesterShift.dayIndex,
          },
          ...(targetShift
            ? [
                {
                  venueId: args.venueId,
                  profileId: swap.requesterProfileId,
                  dayIndex: targetShift.dayIndex,
                },
              ]
            : []),
        ]);
        await this.assertNoDoubleBookTx(
          tx,
          args.venueId,
          swap.targetProfileId,
          requesterShift.dayIndex,
          requesterShift.startMinutes,
          requesterShift.endMinutes,
          requesterShift.id,
          targetShift?.id,
        );
        if (targetShift) {
          await this.assertNoDoubleBookTx(
            tx,
            args.venueId,
            swap.requesterProfileId,
            targetShift.dayIndex,
            targetShift.startMinutes,
            targetShift.endMinutes,
            targetShift.id,
            requesterShift.id,
          );
        }
        await tx.scheduleShift.update({
          where: { id: requesterShift.id },
          data: { profileId: swap.targetProfileId, status: 'scheduled' },
        });
        if (targetShift) {
          await tx.scheduleShift.update({
            where: { id: targetShift.id },
            data: { profileId: swap.requesterProfileId, status: 'scheduled' },
          });
        }
        const reviewed = await tx.shiftSwap.updateMany({
          where: { id: swap.id, status: { in: ['accepted', 'proposed'] } },
          data: { status: 'approved' },
        });
        if (reviewed.count === 0) {
          throw new BadRequestException('Swap is no longer pending');
        }
        await tx.venue.update({
          where: { id: args.venueId },
          data: { scheduleUpdatedAfterPublishAt: new Date() },
        });
      });
    } else {
      await this.prisma.shiftSwap.update({
        where: { id: swap.id },
        data: { status: 'denied' },
      });
    }

    return swap;
  }

  async claimOpenShift(args: {
    venueId: string;
    profileId: string;
    shiftId: string;
  }) {
    const shift = await this.getVenueShift(args.venueId, args.shiftId);
    if (shift.profileId || shift.status !== 'open') {
      throw new BadRequestException('This shift is no longer open');
    }

    await this.assertNoDoubleBook(
      args.venueId,
      args.profileId,
      shift.dayIndex,
      shift.startMinutes,
      shift.endMinutes,
      shift.id,
    );

    const claimed = await this.prisma.scheduleShift.updateMany({
      where: {
        id: shift.id,
        venueId: args.venueId,
        status: 'open',
        profileId: null,
      },
      data: { profileId: args.profileId, status: 'covered' },
    });
    if (claimed.count === 0) {
      throw new BadRequestException('This shift is no longer open');
    }

    await this.markScheduleEdited(args.venueId);
    return shift;
  }

  async applyOpenAssignments(args: {
    venueId: string;
    assignments: Array<{ shiftId: string; profileId: string }>;
    canAssign: (input: {
      shift: {
        id: string;
        venueId: string;
        profileId: string | null;
        dayIndex: number;
        startMinutes: number;
        endMinutes: number;
        jobTitle: string;
        station: string;
        status: string;
      };
      profileId: string;
    }) => boolean | Promise<boolean>;
  }) {
    let assigned = 0;
    let skipped = 0;
    const assignedShifts: Array<{
      profileId: string;
      shiftId: string;
      dayIndex: number;
      startMinutes: number;
      endMinutes: number;
      jobTitle: string;
      station: string;
    }> = [];

    for (const assignment of args.assignments) {
      const shift = await this.getVenueShift(args.venueId, assignment.shiftId);
      if (shift.profileId || shift.status !== 'open') {
        skipped += 1;
        continue;
      }

      await this.assertVenueMember(args.venueId, assignment.profileId);
      const allowed = await args.canAssign({ shift, profileId: assignment.profileId });
      if (!allowed) {
        skipped += 1;
        continue;
      }

      try {
        await withSerializableRetry(this.prisma, async (tx) => {
          const current = await tx.scheduleShift.findFirst({
            where: { id: shift.id, venueId: args.venueId },
          });
          if (!current || current.profileId || current.status !== 'open') {
            throw new BadRequestException('Shift is no longer open.');
          }
          await this.lockAssignmentKeys(tx, [
            {
              venueId: args.venueId,
              profileId: assignment.profileId,
              dayIndex: current.dayIndex,
            },
          ]);
          await this.assertNoDoubleBookTx(
            tx,
            args.venueId,
            assignment.profileId,
            current.dayIndex,
            current.startMinutes,
            current.endMinutes,
            current.id,
          );
          await tx.scheduleShift.update({
            where: { id: current.id },
            data: { profileId: assignment.profileId, status: 'scheduled' },
          });
        });
      } catch (error: any) {
        this.logger.warn(`Auto-assign skipped shift ${shift.id}: ${error?.message ?? String(error)}`);
        skipped += 1;
        continue;
      }

      assigned += 1;
      assignedShifts.push({
        profileId: assignment.profileId,
        shiftId: shift.id,
        dayIndex: shift.dayIndex,
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        jobTitle: shift.jobTitle,
        station: shift.station,
      });
    }

    if (assigned > 0) {
      await this.markScheduleEdited(args.venueId);
    }

    return { assigned, skipped, assignedShifts };
  }

  async assertVenueMember(venueId: string, profileId: string) {
    const member = await this.prisma.profile.findFirst({
      where: {
        id: profileId,
        venueId,
        OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
      },
    });
    if (!member) throw new BadRequestException('Staff member is not in this venue');
    return member;
  }

  async getVenueShift(venueId: string, shiftId: string) {
    const shift = await this.prisma.scheduleShift.findFirst({ where: { id: shiftId, venueId } });
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  async assertNoDoubleBook(
    venueId: string,
    profileId: string,
    dayIndex: number,
    startMinutes: number,
    endMinutes: number,
    ...excludeShiftIds: Array<string | undefined>
  ) {
    await this.assertNoDoubleBookTx(
      this.prisma,
      venueId,
      profileId,
      dayIndex,
      startMinutes,
      endMinutes,
      ...excludeShiftIds,
    );
  }

  async assertNoDoubleBookTx(
    tx: Prisma.TransactionClient | PrismaService,
    venueId: string,
    profileId: string,
    dayIndex: number,
    startMinutes: number,
    endMinutes: number,
    ...excludeShiftIds: Array<string | undefined>
  ) {
    const excluded = excludeShiftIds.filter((id): id is string => Boolean(id));
    const overlapping = await tx.scheduleShift.findFirst({
      where: {
        venueId,
        profileId,
        dayIndex,
        ...(excluded.length > 0 ? { id: { notIn: excluded } } : {}),
        startMinutes: { lt: endMinutes },
        endMinutes: { gt: startMinutes },
      },
    });
    if (overlapping) throw new BadRequestException('This assignment overlaps another shift.');
  }

  async lockAssignmentKeys(
    tx: Prisma.TransactionClient,
    keys: Array<{ venueId: string; profileId: string; dayIndex: number }>,
  ) {
    const uniqueKeys = Array.from(
      new Set(keys.map((key) => `schedule:${key.venueId}:${key.profileId}:${key.dayIndex}`)),
    ).sort();
    for (const key of uniqueKeys) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }
  }

  markScheduleEdited(venueId: string) {
    return this.prisma.venue.update({
      where: { id: venueId },
      data: { scheduleUpdatedAfterPublishAt: new Date() },
    });
  }
}
