import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeForEmail } from '../common/sanitize-email-text';

type EmailArgs = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  bcc?: string[];
};

type EmailMessage = Omit<EmailArgs, 'to' | 'bcc'>;

type ProfileEmailTarget = {
  id: string;
  email: string;
  fullName?: string | null;
};

const MANAGER_ROLES: Role[] = ['admin', 'owner', 'manager'];
const ACTIVE_MEMBERSHIP = [{ membershipStatus: null }, { membershipStatus: 'active' as const }];

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async send(args: EmailArgs) {
    try {
      await this.sendOrThrow(args);
    } catch (error: any) {
      this.logger.warn(`Email delivery failed for ${args.subject}: ${error?.message ?? String(error)}`);
    }
  }

  async sendOrThrow(args: EmailArgs) {
    const to = this.normalizeRecipients(args.to);
    const bcc = args.bcc ? this.normalizeRecipients(args.bcc) : [];
    if (to.length === 0 && bcc.length === 0) return;

    const apiKey = this.config.get<string>('RESEND_API_KEY') ?? this.config.get<string>('EMAIL_API_KEY');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    // Every caller builds subjects from some mix of static copy and
    // user-controlled fields (venue name, guest name, etc.) — sanitize here
    // once rather than relying on each call site to remember to. Body text
    // keeps its newlines since paragraph breaks are meaningful there.
    const subject = sanitizeForEmail(args.subject);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.get<string>('EMAIL_FROM') ?? this.config.get<string>('MAIL_FROM') ?? 'Venue Wrangler <no-reply@venuewrangler.com>',
        to,
        ...(bcc.length ? { bcc } : {}),
        subject,
        text: args.text,
        html: args.html ?? this.textToHtml(args.text),
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Email delivery failed (${response.status}): ${detail || 'Unknown error'}`);
    }
  }

  async sendToProfile(profileId: string, message: EmailMessage) {
    let profile: { email: string } | null;
    try {
      profile = await this.prisma.profile.findUnique({
        where: { id: profileId },
        select: { email: true },
      });
    } catch (error: any) {
      this.logger.error(`Email recipient lookup failed for profile ${profileId}: ${error?.message ?? String(error)}`);
      return;
    }
    if (!profile) return;
    return this.send({ to: profile.email, ...message });
  }

  async sendToVenueManagers(venueId: string, message: EmailMessage) {
    let managers: ProfileEmailTarget[];
    try {
      managers = await this.prisma.profile.findMany({
        where: { venueId, role: { in: MANAGER_ROLES }, OR: ACTIVE_MEMBERSHIP },
        select: { id: true, email: true, fullName: true },
      });
    } catch (error: any) {
      this.logger.error(`Email recipient lookup failed for venue managers ${venueId}: ${error?.message ?? String(error)}`);
      return;
    }
    return this.sendToProfiles(managers, message);
  }

  async sendToVenueStaff(venueId: string, message: EmailMessage) {
    let staff: ProfileEmailTarget[];
    try {
      staff = await this.prisma.profile.findMany({
        where: { venueId, OR: ACTIVE_MEMBERSHIP },
        select: { id: true, email: true, fullName: true },
      });
    } catch (error: any) {
      this.logger.error(`Email recipient lookup failed for venue staff ${venueId}: ${error?.message ?? String(error)}`);
      return;
    }
    return this.sendToProfiles(staff, message);
  }

  async sendToProfiles(profiles: ProfileEmailTarget[], message: EmailMessage) {
    const recipients = profiles.map((profile) => profile.email);
    if (recipients.length === 0) return;
    // Resend's "to" is a visible recipient list, not a blind list — putting
    // every staff/manager email there would let each recipient see everyone
    // else's address. Broadcast via bcc instead; "to" still needs a
    // non-empty value, so it points at our own from-address as a placeholder.
    const from = this.config.get<string>('EMAIL_FROM') ?? this.config.get<string>('MAIL_FROM') ?? 'Venue Wrangler <no-reply@venuewrangler.com>';
    return this.send({ to: from, bcc: recipients, ...message });
  }

  private normalizeRecipients(input: string | string[]) {
    const recipients = Array.isArray(input) ? input : [input];
    return Array.from(
      new Set(
        recipients
          .map((recipient) => recipient.trim().toLowerCase())
          .filter((recipient) => recipient.includes('@') && !recipient.endsWith('@venuewrangler.local')),
      ),
    );
  }

  private textToHtml(text: string) {
    return text
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${this.escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
