import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BarInventoryParserService } from './bar-inventory-parser.service';

describe('BarInventoryParserService', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalSharedApiKey = process.env.AI_API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalSharedApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalSharedApiKey;
    vi.unstubAllGlobals();
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
    delete process.env.AI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    await expect(service.parse({})).rejects.toThrow('Add pasted text');
    await expect(service.parse({ text: 'x'.repeat(20_001) })).rejects.toThrow('Text imports are limited');
    await expect(service.parse({ imageBase64: 'abc', imageMimeType: 'application/pdf' })).rejects.toThrow('Photo imports');
  });

  it('prefers AI_API_KEY while retaining OPENAI_API_KEY as a fallback', async () => {
    process.env.AI_API_KEY = 'sk-or-primary';
    process.env.OPENAI_API_KEY = 'sk-legacy';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"notes":"","items":[]}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await new BarInventoryParserService().parse({ text: 'two bottles of gin' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-or-primary' }),
      }),
    );
  });
});
