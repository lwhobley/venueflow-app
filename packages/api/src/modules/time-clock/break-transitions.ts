import { BadRequestException } from '@nestjs/common';
import { parseTimeBreaks } from '../../common/break-duration';
import type { PrismaService } from '../../prisma/prisma.service';

/** Shared optimistic-concurrency transition used by current and legacy routes. */
export async function startBreakForProfile(
  prisma: PrismaService,
  profileId: string,
  type: 'paid' | 'unpaid',
) {
  const entry = await prisma.timeEntry.findFirst({
    where: { profileId, isOpen: true },
  });
  if (!entry) throw new BadRequestException('No active clock-in found');

  const breaks = parseTimeBreaks(entry.breaks);
  if (breaks.some((breakRow) => breakRow.endAt === null)) {
    throw new BadRequestException('Already on a break');
  }

  const nextBreaks = [...breaks, { startAt: Date.now(), endAt: null, type }];
  const updated = await prisma.timeEntry.updateMany({
    where: { id: entry.id, isOpen: true, updatedAt: entry.updatedAt },
    data: { breaks: nextBreaks },
  });
  if (updated.count === 0) {
    throw new BadRequestException('Break state changed. Refresh and try again.');
  }
  return prisma.timeEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: { profile: true, venue: true },
  });
}

/** Shared optimistic-concurrency transition used by current and legacy routes. */
export async function endBreakForProfile(prisma: PrismaService, profileId: string) {
  const entry = await prisma.timeEntry.findFirst({
    where: { profileId, isOpen: true },
  });
  if (!entry) throw new BadRequestException('No active clock-in found');

  const breaks = parseTimeBreaks(entry.breaks);
  const activeBreakIndex = breaks.findIndex((breakRow) => breakRow.endAt === null);
  if (activeBreakIndex === -1) throw new BadRequestException('Not currently on a break');

  const nextBreaks = [...breaks];
  nextBreaks[activeBreakIndex] = {
    ...nextBreaks[activeBreakIndex],
    endAt: Date.now(),
  };
  const updated = await prisma.timeEntry.updateMany({
    where: { id: entry.id, isOpen: true, updatedAt: entry.updatedAt },
    data: { breaks: nextBreaks },
  });
  if (updated.count === 0) {
    throw new BadRequestException('Break state changed. Refresh and try again.');
  }
  return prisma.timeEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: { profile: true, venue: true },
  });
}
