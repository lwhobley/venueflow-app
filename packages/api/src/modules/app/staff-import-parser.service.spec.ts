import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { StaffImportParserService } from './staff-import-parser.service';

describe('StaffImportParserService', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalAiApiKey = process.env.AI_API_KEY;

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.AI_API_KEY = originalAiApiKey;
  });

  it('normalizes parsed staff rows and drops rows without an email or name', () => {
    const service = new StaffImportParserService();
    const parsed = service.normalize({
      items: [
        { fullName: '  Alex Morgan ', email: ' Alex@Example.com ', phone: ' 504-555-0100 ', jobTitle: ' Bartender ', role: 'staff' },
        { fullName: 'Sam GM', email: 'sam@example.com', jobTitle: 'General Manager', role: 'manager' },
        { fullName: 'No Email' },
        { email: 'no-name@example.com' },
      ],
    });

    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toEqual({
      fullName: 'Alex Morgan',
      email: 'alex@example.com',
      phone: '504-555-0100',
      jobTitle: 'Bartender',
      role: 'staff',
    });
    expect(parsed.items[1].role).toBe('manager');
  });

  it('defaults an unrecognized role to staff and a missing job title to Team Member', () => {
    const service = new StaffImportParserService();
    const parsed = service.normalize({ items: [{ fullName: 'Jordan Lee', email: 'jordan@example.com', role: 'owner' }] });
    expect(parsed.items[0].role).toBe('staff');
    expect(parsed.items[0].jobTitle).toBe('Team Member');
  });

  it('rejects invalid parser output shape', () => {
    const service = new StaffImportParserService();
    expect(() => service.normalize({ notRows: [] })).toThrow(BadRequestException);
  });

  it('validates input before provider calls', async () => {
    const service = new StaffImportParserService();
    process.env.AI_API_KEY = 'sk-or-test';
    await expect(service.parse('')).rejects.toThrow('Paste a staff list');
    await expect(service.parse('x'.repeat(40_001))).rejects.toThrow('Staff imports are limited');
  });

  it('requires an AI key before parsing', async () => {
    const service = new StaffImportParserService();
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_API_KEY;
    await expect(service.parse('Alex Morgan, alex@example.com, Bartender')).rejects.toThrow('AI_API_KEY');
  });
});
