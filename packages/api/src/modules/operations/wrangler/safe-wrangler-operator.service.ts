import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReservationMutationService } from '../../reservations/reservation-mutation.service';
import { SchedulingAssignmentService } from '../../scheduling/scheduling-assignment.service';
import { WranglerOperatorService } from './wrangler-operator.service';

@Injectable()
export class SafeWranglerOperatorService extends WranglerOperatorService {
  constructor(
    prisma: PrismaService,
    private readonly safePrisma: PrismaService,
    private readonly reservations: ReservationMutationService,
    private readonly scheduling: SchedulingAssignmentService,
  ) {
    super(prisma);
  }

  override async plan(input: any) {
    const result: any = await super.plan(input);
    if (result?.status === 'confirmation_required' && result?.tool === 'CORRECT_PUNCH') {
      const entryId = result?.plan?.args?.entryId;
      if (entryId) {
        const entry = await this.safePrisma.timeEntry.findFirst({
          where: { id: String(entryId), venueId: input.venueId },
          select: { updatedAt: true },
        });
        if (entry) result.plan.args.expectedUpdatedAt = entry.updatedAt.toISOString();
      }
    }
    return result;
  }

  override async execute(input: any) {
    if (!(input.actor?.allAccess || ['owner', 'admin', 'manager'].includes(String(input.actor?.role)))) {
      throw new ForbiddenException('Manager access required for Wrangler operator actions');
    }

    const tool = String(input.plan?.tool ?? '');
    if (!['CREATE_RESERVATION', 'UPDATE_RESERVATION', 'CANCEL_RESERVATION', 'UPDATE_SHIFT', 'ASSIGN_SHIFT', 'CORRECT_PUNCH'].includes(tool)) {
      return super.execute(input);
    }

    const args = { ...(input.plan?.args ?? {}) };
    let result: any;

    if (tool === 'CREATE_RESERVATION') {
      const guestName = this.text(args.guestName, 'Guest name is required');
      const partySize = this.positiveInt(args.partySize, 'partySize');
      const reservationTime = this.date(args.reservationTime, 'Reservation time is required');
      const saved = await this.reservations.saveReservation({
        venueId: input.venueId,
        guestName,
        partySize,
        reservationTime: reservationTime.toISOString(),
        durationMinutes: args.durationMinutes == null ? 90 : this.positiveInt(args.durationMinutes, 'durationMinutes'),
        notes: typeof args.notes === 'string' ? args.notes : undefined,
        status: 'confirmed',
        source: 'direct',
      });
      result = this.reservationResult(saved.reservation);
    }

    if (tool === 'UPDATE_RESERVATION') {
      const id = this.text(args.reservationId, 'reservationId is required');
      const existing = await this.safePrisma.reservation.findFirst({ where: { id, venueId: input.venueId, deletedAt: null } });
      if (!existing) throw new NotFoundException('Reservation no longer exists');
      const status = args.status == null ? existing.status : this.text(args.status, 'Invalid reservation status');
      if (!['requested', 'confirmed', 'checked_in', 'seated', 'completed', 'no_show', 'cancelled'].includes(status)) {
        throw new BadRequestException('Invalid reservation status');
      }
      const saved = await this.reservations.saveReservation({
        venueId: input.venueId,
        reservationId: existing.id,
        guestName: existing.guestName,
        partySize: args.partySize == null ? existing.partySize : this.positiveInt(args.partySize, 'partySize'),
        reservationTime: args.reservationTime == null ? existing.reservationTime.toISOString() : this.date(args.reservationTime, 'Invalid reservation time').toISOString(),
        durationMinutes: existing.durationMinutes,
        status,
        notes: args.notes == null ? existing.notes ?? undefined : String(args.notes),
        source: existing.source,
        tags: existing.tags,
        specialRequests: existing.specialRequests ?? undefined,
        phone: existing.guestPhone ?? undefined,
        email: existing.guestEmail ?? undefined,
        guestCompany: existing.guestCompany ?? undefined,
        occasion: existing.occasion ?? undefined,
        isPrivateEvent: existing.isPrivateEvent ?? undefined,
        eventName: existing.eventName ?? undefined,
        eventStatus: existing.eventStatus ?? undefined,
        eventSpace: existing.eventSpace ?? undefined,
        setupStyle: existing.setupStyle ?? undefined,
        menuNotes: existing.menuNotes ?? undefined,
        beverageNotes: existing.beverageNotes ?? undefined,
        billingNotes: existing.billingNotes ?? undefined,
        contractStatus: existing.contractStatus ?? undefined,
        beoStatus: existing.beoStatus ?? undefined,
        estimatedValueCents: existing.estimatedValueCents ?? undefined,
        depositDueCents: existing.depositDueCents ?? undefined,
      });
      result = this.reservationResult(saved.reservation);
    }

    if (tool === 'CANCEL_RESERVATION') {
      const id = this.text(args.reservationId, 'reservationId is required');
      const updated = await this.safePrisma.reservation.updateMany({
        where: { id, venueId: input.venueId, deletedAt: null },
        data: { status: 'cancelled' },
      });
      if (!updated.count) throw new NotFoundException('Reservation no longer exists');
      const row = await this.safePrisma.reservation.findUniqueOrThrow({ where: { id } });
      result = { id: row.id, guestName: row.guestName, status: row.status };
    }

    if (tool === 'UPDATE_SHIFT') {
      const id = this.text(args.shiftId, 'shiftId is required');
      const existing = await this.safePrisma.scheduleShift.findFirst({ where: { id, venueId: input.venueId } });
      if (!existing) throw new NotFoundException('Shift no longer exists');
      const startMinutes = args.startMinutes == null ? existing.startMinutes : this.minute(args.startMinutes, 'startMinutes');
      const endMinutes = args.endMinutes == null ? existing.endMinutes : this.minute(args.endMinutes, 'endMinutes');
      if (endMinutes <= startMinutes) throw new BadRequestException('Shift end must be after shift start');
      await this.scheduling.updateShift({
        venueId: input.venueId,
        shiftId: existing.id,
        dayIndex: existing.dayIndex,
        startMinutes,
        endMinutes,
        jobTitle: args.jobTitle == null ? existing.jobTitle : this.text(args.jobTitle, 'jobTitle is required'),
        station: args.station == null ? existing.station : this.text(args.station, 'station is required'),
        notes: existing.notes ?? undefined,
      });
      const row = await this.safePrisma.scheduleShift.findUniqueOrThrow({ where: { id: existing.id } });
      result = { id: row.id, startMinutes: row.startMinutes, endMinutes: row.endMinutes, profileId: row.profileId, status: row.status };
    }

    if (tool === 'ASSIGN_SHIFT') {
      const shiftId = this.text(args.shiftId, 'shiftId is required');
      const profileId = this.text(args.profileId, 'profileId is required');
      await this.scheduling.assignShift({ venueId: input.venueId, shiftId, profileId });
      const [shift, profile] = await Promise.all([
        this.safePrisma.scheduleShift.findFirst({ where: { id: shiftId, venueId: input.venueId } }),
        this.safePrisma.profile.findFirst({ where: { id: profileId, venueId: input.venueId } }),
      ]);
      if (!shift || !profile) throw new NotFoundException('Shift or staff member no longer exists');
      result = { id: shift.id, profileId: profile.id, staffName: profile.fullName, status: shift.status };
    }

    if (tool === 'CORRECT_PUNCH') {
      const entryId = this.text(args.entryId, 'entryId is required');
      const expectedUpdatedAt = this.date(args.expectedUpdatedAt, 'Punch changed since preview. Review the latest timecard before correcting it.');
      const entry = await this.safePrisma.timeEntry.findFirst({ where: { id: entryId, venueId: input.venueId } });
      if (!entry) throw new NotFoundException('Time entry no longer exists');
      const clockInAt = args.clockInAt == null ? entry.clockInAt : this.date(args.clockInAt, 'Invalid clock-in');
      const clockOutAt = args.clockOutAt == null ? entry.clockOutAt : this.date(args.clockOutAt, 'Invalid clock-out');
      if (clockOutAt && clockOutAt <= clockInAt) throw new BadRequestException('Clock-out must be after clock-in');
      const changed = await this.safePrisma.timeEntry.updateMany({
        where: { id: entry.id, venueId: input.venueId, updatedAt: expectedUpdatedAt },
        data: { clockInAt, clockOutAt, isOpen: clockOutAt == null },
      });
      if (!changed.count) throw new ConflictException('Punch changed since Wrangler reviewed it. Review the latest timecard before correcting it.');
      const row = await this.safePrisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
      result = { id: row.id, profileId: row.profileId, clockInAt: row.clockInAt.getTime(), clockOutAt: row.clockOutAt?.getTime() ?? null, isOpen: row.isOpen };
    }

    const risk = ['CANCEL_RESERVATION', 'CORRECT_PUNCH'].includes(tool) ? 'sensitive_write' : 'operational_write';
    await this.safePrisma.auditLog.create({
      data: {
        venueId: input.venueId,
        actorProfileId: input.actor.profileId,
        actorName: input.actor.fullName,
        actorRole: input.actor.role,
        entityType: 'wrangler_operator',
        entityId: String(result?.id ?? args.reservationId ?? args.shiftId ?? args.entryId ?? tool),
        action: `wrangler_operator_${tool.toLowerCase()}`,
        summary: String(input.plan?.summary ?? tool.toLowerCase().replaceAll('_', ' ')),
        metadata: { tool, risk } as any,
      },
    });
    return { ok: true, tool, risk, result };
  }

  private text(value: unknown, message: string) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new BadRequestException(message);
    return text;
  }

  private positiveInt(value: unknown, field: string) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new BadRequestException(`${field} must be a positive whole number`);
    return n;
  }

  private minute(value: unknown, field: string) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 1440) throw new BadRequestException(`${field} must be between 0 and 1440`);
    return n;
  }

  private date(value: unknown, message: string) {
    const date = new Date(String(value ?? ''));
    if (Number.isNaN(date.getTime())) throw new BadRequestException(message);
    return date;
  }

  private reservationResult(row: any) {
    return { id: row.id, guestName: row.guestName, partySize: row.partySize, reservationTime: row.reservationTime.getTime(), status: row.status };
  }
}
