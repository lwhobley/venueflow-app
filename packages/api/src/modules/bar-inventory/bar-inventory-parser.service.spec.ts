import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithAiUsageContext } from '../../common/ai-usage-context';
import { BarInventoryParserService } from './bar-inventory-parser.service';

function makeAiUsagePrisma() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    aiUsageEvent: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { estimatedCostMicros: 0 } }),
      create: vi.fn().mockResolvedValue(undefined),
    },
    aiBudgetReservation: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { reservedCostMicros: 0 } }),
      create: vi.fn().mockResolvedValue(undefined),
    },
  };
  return {
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    aiBudgetReservation: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  } as any;
}

describe('BarInventoryParserService', () => {
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (originalGeminiApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiApiKey;
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
    process.env.GEMINI_API_KEY = 'gemini-test';
    await expect(service.parse({})).rejects.toThrow('Add pasted text');
    await expect(service.parse({ text: 'x'.repeat(20_001) })).rejects.toThrow('Text imports are limited');
    await expect(service.parse({ imageBase64: 'abc', imageMimeType: 'application/pdf' })).rejects.toThrow('Photo imports');
  });

  it('calls Gemini with the configured key', async () => {
    process.env.GEMINI_API_KEY = 'gemini-key';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ totalTokens: 10 }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: '{"notes":"","items":[]}' }] } }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await runWithAiUsageContext(
      { venueId: 'venue-1', profileId: 'profile-1', prisma: makeAiUsagePrisma() },
      () => new BarInventoryParserService().parse({ text: 'two bottles of gin' }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-key' }),
      }),
    );
  });
});
