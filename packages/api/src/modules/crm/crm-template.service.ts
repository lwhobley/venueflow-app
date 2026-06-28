import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type TemplateRecord = {
  subject: string;
  body: string;
};

@Injectable()
export class CrmTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async renderTemplate(template: TemplateRecord, venueId: string, leadId?: string, beoId?: string) {
    const context = await this.buildContext(venueId, leadId, beoId);
    return {
      subject: this.substituteVariables(template.subject, context),
      body: this.substituteVariables(template.body, context),
      context,
    };
  }

  substituteVariables(template: string, context: Record<string, string>): string {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => context[key] ?? '');
  }

  private async buildContext(venueId: string, leadId?: string, beoId?: string) {
    const [venue, lead, beo] = await Promise.all([
      this.prisma.venue.findUnique({ where: { id: venueId }, select: { name: true } }),
      leadId
        ? this.prisma.crmLead.findFirst({ where: { id: leadId, venueId }, select: { fullName: true, email: true, phone: true, company: true, source: true } })
        : null,
      beoId
        ? this.prisma.crmBeo.findFirst({ where: { id: beoId, venueId } })
        : null,
    ]);

    const ctx: Record<string, string> = { 'venue.name': venue?.name ?? '' };
    if (lead) {
      ctx['lead.name'] = lead.fullName;
      ctx['lead.firstName'] = lead.fullName.split(/\s+/)[0] ?? lead.fullName;
      ctx['lead.email'] = lead.email ?? '';
      ctx['lead.phone'] = lead.phone ?? '';
      ctx['lead.company'] = lead.company ?? '';
      ctx['lead.source'] = lead.source ?? '';
    }
    if (beo) {
      ctx['event.name'] = beo.eventName;
      ctx['event.date'] = beo.eventDate ? beo.eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
      ctx['event.space'] = beo.venueSpace ?? '';
      ctx['event.guestCount'] = String(beo.guestCount ?? '');
      ctx['event.deposit'] = beo.depositCents ? `$${(beo.depositCents / 100).toFixed(2)}` : '';
    }
    return ctx;
  }
}
