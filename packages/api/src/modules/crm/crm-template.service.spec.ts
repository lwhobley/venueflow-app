import { describe, expect, it, vi } from 'vitest';
import { CrmTemplateService } from './crm-template.service';

describe('CrmTemplateService', () => {
  it('substitutes known variables and removes unknown placeholders', () => {
    const service = new CrmTemplateService({} as any);
    expect(service.substituteVariables('Hi {{ lead.firstName }} from {{venue.name}} {{missing}}', {
      'lead.firstName': 'Ava',
      'venue.name': 'Green Room',
    })).toBe('Hi Ava from Green Room ');
  });

  it('renders templates with venue, lead, and BEO context', async () => {
    const prisma = {
      venue: { findUnique: vi.fn().mockResolvedValue({ name: 'Green Room' }) },
      crmLead: {
        findFirst: vi.fn().mockResolvedValue({
          fullName: 'Ava Morgan',
          email: 'ava@example.com',
          phone: '555',
          company: 'AM Events',
          source: 'Website',
        }),
      },
      crmBeo: {
        findFirst: vi.fn().mockResolvedValue({
          eventName: 'Launch Party',
          eventDate: new Date('2026-07-04T18:00:00.000Z'),
          venueSpace: 'Patio',
          guestCount: 80,
          depositCents: 250000,
        }),
      },
    };
    const service = new CrmTemplateService(prisma as any);

    const rendered = await service.renderTemplate(
      {
        subject: '{{venue.name}} / {{event.name}}',
        body: 'Hi {{lead.firstName}}, deposit {{event.deposit}} for {{event.space}}.',
      },
      'venue-1',
      'lead-1',
      'beo-1',
    );

    expect(rendered.subject).toBe('Green Room / Launch Party');
    expect(rendered.body).toBe('Hi Ava, deposit $2500.00 for Patio.');
    expect(rendered.context['lead.email']).toBe('ava@example.com');
  });
});
