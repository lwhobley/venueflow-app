import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { BarInventoryParserService } from './bar-inventory-parser.service';

describe('BarInventoryParserService', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
  });

  it('normalizes parsed inventory rows', () => {
    const service = new BarInventoryParserService();
    const parsed = service.normalizeParsedInventory({
      notes: 'count sheet',
      items: [
        {
          name: 'House Vodka',
          category: 'spirit',
          area: '  Bar 1 ',
          unit: 'bottle',
          parLevel: 4,
          onHand: 2,
          unitCostCents: 1800,
          supplier: '  Distributor ',
          sku: ' HV-1 ',
          notes: '  low ',
        },
        {
          name: 'Mystery',
          category: 'unknown',
        },
      ],
    });

    expect(parsed.notes).toBe('count sheet');
    expect(parsed.items[0]).toEqual({
      name: 'House Vodka',
      category: 'spirit',
      area: 'Bar 1',
      unit: 'bottle',
      parLevel: 4,
      onHand: 2,
      unitCostCents: 1800,
      supplier: 'Distributor',
      sku: 'HV-1',
      notes: 'low',
    });
    expect(parsed.items[1].category).toBe('other');
    expect(parsed.items[1].unit).toBe('unit');
  });

  it('rejects invalid parser output shape', () => {
    const service = new BarInventoryParserService();
    expect(() => service.normalizeParsedInventory({ notes: 'missing items' })).toThrow(BadRequestException);
  });

  it('validates input before provider calls', async () => {
    const service = new BarInventoryParserService();
    process.env.OPENAI_API_KEY = 'sk-test';
    await expect(service.parse({})).rejects.toThrow('Add pasted text');
    await expect(service.parse({ text: 'x'.repeat(20_001) })).rejects.toThrow('Text imports are limited');
    await expect(service.parse({ imageBase64: 'abc', imageMimeType: 'application/pdf' })).rejects.toThrow('Photo imports');
  });
});
