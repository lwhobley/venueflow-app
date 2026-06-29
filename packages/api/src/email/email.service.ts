import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type EmailArgs = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

type EmailMessage = Omit<EmailArgs, 'to'>;

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
    if (to.length === 0) return;

    const apiKey = this.config.get<string>('RESEND_API_KEY') ?? this.config.get<string>('EMAIL_API_KEY');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.get<string>('EMAIL_FROM') ?? this.config.get<string>('MAIL_FROM') ?? 'Venue Wrangler <no-reply@venuewrangler.com>',
        to,
        subject: args.subject,
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
    try {
      const profile = await this.prisma.profile.findUnique({
        where: { id: profileId },
        select: { email: true },
      });
      if (!profile) return;
      return this.send({ to: profile.email, ...message });
    } catch (error: any) {
      this.logger.warn(`Email lookup failed for profile ${profileId}: ${error?.message ?? String(error)}`);
    }
  }

  async sendToVenueManagers(venueId: string, message: EmailMessage) {
    try {
      const managers = await this.prisma.profile.findMany({
        where: { venueId, role: { in: MANAGER_ROLES }, OR: ACTIVE_MEMBERSHIP },
        select: { id: true, email: true, fullName: true },
      });
      return this.sendToProfiles(managers, message);
    } catch (error: any) {
      this.logger.warn(`Email lookup failed for venue managers ${venueId}: ${error?.message ?? String(error)}`);
    }
  }

  async sendToVenueStaff(venueId: string, message: EmailMessage) {
    try {
      const staff = await this.prisma.profile.findMany({
        where: { venueId, OR: ACTIVE_MEMBERSHIP },
        select: { id: true, email: true, fullName: true },
      });
      return this.sendToProfiles(staff, message);
    } catch (error: any) {
      this.logger.warn(`Email lookup failed for venue staff ${venueId}: ${error?.message ?? String(error)}`);
    }
  }

  async sendToProfiles(profiles: ProfileEmailTarget[], message: EmailMessage) {
    const recipients = profiles.map((profile) => profile.email);
    return this.send({ to: recipients, ...message });
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
