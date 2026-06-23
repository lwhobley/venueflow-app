import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailService } from '../../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';

const REMINDER_WINDOW_MIN_HOURS = 20;
const REMINDER_WINDOW_MAX_HOURS = 28;
const REMINDER_BATCH_LIMIT = 200;

function formatBookingTime(time: Date): string {
  return time.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

@Injectable()
export class ReservationNotifierService {
  private readonly logger = new Logger(ReservationNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** Send a "your reservation is confirmed" email immediately on booking. */
  async sendConfirmation(reservationId: string): Promise<void> {
    // Atomically claim the confirmation slot. If two concurrent calls race,
    // only the one that sees count === 1 proceeds — the other returns early.
    const claimed = await this.prisma.reservation.updateMany({
      where: { id: reservationId, confirmationSentAt: null, deletedAt: null },
      data: { confirmationSentAt: new Date() },
    });
    if (claimed.count === 0) return; // already sent, deleted, or not found

    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { venue: { select: { name: true } } },
    });
    if (!reservation?.guestEmail) return;
    const venueName = reservation.venue.name;
    const when = formatBookingTime(reservation.reservationTime);
    const subject = `${venueName} — Reservation confirmed for ${when}`;
    const text = [
      `Hi ${reservation.guestName.split(' ')[0] ?? reservation.guestName},`,
      '',
      `We're looking forward to seeing you at ${venueName}.`,
      '',
      `When: ${when}`,
      `Party: ${reservation.partySize}`,
      reservation.specialRequests ? `Notes: ${reservation.specialRequests}` : null,
      '',
      'If your plans change, please reply to this email so we can offer the table to another guest.',
      '',
      `— ${venueName}`,
    ]
      .filter(Boolean)
      .join('\n');
    await this.email.send({
      to: reservation.guestEmail,
      subject,
      text,
    });
  }

  /**
   * Hourly cron: send "see you tomorrow" reminders for bookings 20–28h out
   * that haven't been reminded yet. The window is intentionally wide so a
   * missed run still catches every reservation exactly once.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sendUpcomingReminders(): Promise<{ sent: number }> {
    const now = Date.now();
    const minTime = new Date(now + REMINDER_WINDOW_MIN_HOURS * 60 * 60 * 1000);
    const maxTime = new Date(now + REMINDER_WINDOW_MAX_HOURS * 60 * 60 * 1000);
    const candidates = await this.prisma.reservation.findMany({
      where: {
        deletedAt: null,
        reminderSentAt: null,
        status: { in: ['confirmed', 'requested', 'checked_in'] },
        reservationTime: { gte: minTime, lte: maxTime },
        guestEmail: { not: null },
      },
      include: { venue: { select: { name: true } } },
      take: REMINDER_BATCH_LIMIT,
    });
    let sent = 0;
    for (const reservation of candidates) {
      if (!reservation.guestEmail) continue;
      const venueName = reservation.venue.name;
      const when = formatBookingTime(reservation.reservationTime);
      const subject = `${venueName} — Reminder: ${when}`;
      const text = [
        `Hi ${reservation.guestName.split(' ')[0] ?? reservation.guestName},`,
        '',
        `A quick reminder that we'll see you at ${venueName} on ${when} for a party of ${reservation.partySize}.`,
        '',
        'If anything has changed, please reply and let us know.',
        '',
        `— ${venueName}`,
      ].join('\n');
      try {
        await this.email.sendOrThrow({ to: reservation.guestEmail, subject, text });
        await this.prisma.reservation.update({
          where: { id: reservation.id },
          data: { reminderSentAt: new Date() },
        });
        sent += 1;
      } catch (err) {
        this.logger.warn(`Reservation reminder failed for ${reservation.id}: ${(err as Error).message}`);
      }
    }
    if (sent > 0) this.logger.log(`Sent ${sent} reservation reminders`);
    return { sent };
  }

  /**
   * Best-effort: notify the next matching waitlist entry that a table opened.
   * Called when an assignment is released. Picks the longest-waiting entry
   * with partySize ≤ openSeats and an email on file; marks notifiedAt so we
   * don't double-notify on subsequent releases.
   */
  async notifyNextWaitlist(venueId: string, openSeats: number): Promise<void> {
    if (openSeats <= 0) return;
    const entry = await this.prisma.waitlist.findFirst({
      where: {
        venueId,
        status: 'waiting',
        notifiedAt: null,
        partySize: { lte: openSeats },
        guestEmail: { not: null },
      },
      orderBy: { requestedAt: 'asc' },
      include: { venue: { select: { name: true } } },
    });
    if (!entry?.guestEmail) return;
    const venueName = entry.venue.name;
    try {
      await this.email.sendOrThrow({
        to: entry.guestEmail,
        subject: `${venueName} — Your table is ready`,
        text: [
          `Hi ${entry.guestName.split(' ')[0] ?? entry.guestName},`,
          '',
          `Good news — a table for ${entry.partySize} just opened up at ${venueName}.`,
          'Please check in with the host within 10 minutes to claim it.',
          '',
          `— ${venueName}`,
        ].join('\n'),
      });
      // readyAt acts as the "table is available" signal; status stays
       // 'waiting' until the host actually seats them via the floor screen.
      await this.prisma.waitlist.update({
        where: { id: entry.id },
        data: { notifiedAt: new Date(), readyAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(`Waitlist notify failed for ${entry.id}: ${(err as Error).message}`);
    }
  }
}
