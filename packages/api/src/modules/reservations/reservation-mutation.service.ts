import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ReservationSource, ReservationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionAutopilotService } from '../operations/execution-autopilot.service';

@Injectable()
export class ReservationMutationService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly autopilot?: ExecutionAutopilotService,
  ) {}

  async saveReservation(args: {
    venueId: string;
    reservationId?: string;
    guestName: string;
    partySize: number;
    reservationTime: string;
    durationMinutes?: number;
    status?: string;
    notes?: string;
    source?: string;
    tags?: string[];
    specialRequests?: string;
    tableNumbers?: string[];
    phone?: string;
    email?: string;
    guestCompany?: string;
    occasion?: string;
    isPrivateEvent?: boolean;
    eventName?: string;
    eventStatus?: string;
    eventSpace?: string;
    setupStyle?: string;
    menuNotes?: string;
    beverageNotes?: string;
    billingNotes?: string;
    contractStatus?: string;
    beoStatus?: string;
    estimatedValueCents?: number;
    depositDueCents?: number;
  }) {
    const guestName = args.guestName.trim();
    if (!guestName) throw new BadRequestException('Guest name is required');
    if (!args.reservationTime) throw new BadRequestException('Reservation time is required');

    const reservationTime = new Date(args.reservationTime);
    if (isNaN(reservationTime.getTime())) {
      throw new BadRequestException('Invalid reservation time');
    }

    const data = {
      venueId: args.venueId,
      guestName,
      partySize: args.partySize,
      reservationTime,
      status: (args.status ?? 'confirmed') as ReservationStatus,
      source: (args.source ?? 'direct') as ReservationSource,
      tags: args.tags ?? [],
      notes: args.notes?.trim() ?? null,
      specialRequests: args.specialRequests?.trim() ?? null,
      guestPhone: args.phone?.trim() ?? null,
      guestEmail: args.email?.trim() ?? null,
      guestCompany: args.guestCompany?.trim() ?? null,
      occasion: args.occasion?.trim() ?? null,
      isPrivateEvent: args.isPrivateEvent ?? null,
      eventName: args.eventName?.trim() ?? null,
      eventStatus: args.eventStatus?.trim() ?? null,
      eventSpace: args.eventSpace?.trim() ?? null,
      setupStyle: args.setupStyle?.trim() ?? null,
      menuNotes: args.menuNotes?.trim() ?? null,
      beverageNotes: args.beverageNotes?.trim() ?? null,
      billingNotes: args.billingNotes?.trim() ?? null,
      contractStatus: args.contractStatus?.trim() ?? null,
      beoStatus: args.beoStatus?.trim() ?? null,
      estimatedValueCents: args.estimatedValueCents ?? null,
      depositDueCents: args.depositDueCents ?? null,
      durationMinutes: args.durationMinutes ?? 90,
    };

    await this.assertNoHoldConflict(args.venueId, reservationTime, data.durationMinutes);

    if (args.reservationId) {
      const existing = await this.prisma.reservation.findFirst({
        where: { id: args.reservationId, venueId: args.venueId },
      });
      if (!existing) throw new BadRequestException('Reservation not found');

      const updated = await this.prisma.reservation.update({
        where: { id: existing.id },
        data,
      });
      await this.ensureExecutionWorkspace(updated);
      return { reservation: updated, previousStatus: existing.status };
    }

    const created = await this.prisma.reservation.create({ data });
    await this.ensureExecutionWorkspace(created);
    return { reservation: created, previousStatus: null };
  }

  async createHold(args: {
    venueId: string;
    startsAt: string;
    endsAt: string;
    reason: string;
  }) {
    const startsAt = new Date(args.startsAt);
    const endsAt = new Date(args.endsAt);
    if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
      throw new BadRequestException('Invalid date');
    }
    if (endsAt <= startsAt) throw new BadRequestException('endsAt must be after startsAt');

    const reason = args.reason.trim();
    if (!reason) throw new BadRequestException('reason is required');

    return this.prisma.reservationHold.create({
      data: { venueId: args.venueId, startsAt, endsAt, reason },
    });
  }

  async deleteHold(args: {
    venueId: string;
    holdId: string;
  }) {
    const existing = await this.prisma.reservationHold.findFirst({
      where: { id: args.holdId, venueId: args.venueId },
    });
    if (!existing) throw new BadRequestException('Hold not found');

    await this.prisma.reservationHold.delete({ where: { id: args.holdId } });
  }

  async removeReservation(args: {
    venueId: string;
    reservationId: string;
  }) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id: args.reservationId, venueId: args.venueId },
    });
    if (!reservation) throw new BadRequestException('Reservation not found');

    await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { deletedAt: new Date() },
    });
  }

  private async assertNoHoldConflict(venueId: string, reservationTime: Date, durationMinutes: number) {
    const endTime = new Date(reservationTime.getTime() + durationMinutes * 60 * 1000);
    const hold = await this.prisma.reservationHold.findFirst({
      where: {
        venueId,
        startsAt: { lt: endTime },
        endsAt: { gt: reservationTime },
      },
      select: { reason: true },
    });
    if (hold) {
      throw new BadRequestException(`This time conflicts with a hold: ${hold.reason}`);
    }
  }

  private async ensureExecutionWorkspace(reservation: {
    id: string;
    venueId: string;
    status: string;
    isPrivateEvent: boolean | null;
    eventName: string | null;
    guestName: string;
    reservationTime: Date;
    durationMinutes: number;
    setupStyle: string | null;
    eventSpace: string | null;
  }) {
    if (!this.autopilot || !reservation.isPrivateEvent || ['cancelled', 'no_show'].includes(reservation.status)) return;
    await this.autopilot.ensureWorkspace({
      venueId: reservation.venueId,
      sourceType: 'reservation',
      sourceId: reservation.id,
      title: reservation.eventName || reservation.guestName || 'Private event',
      startsAt: reservation.reservationTime,
      endsAt: new Date(reservation.reservationTime.getTime() + reservation.durationMinutes * 60_000),
      setupStyle: reservation.setupStyle || reservation.eventSpace,
    });
  }
}
