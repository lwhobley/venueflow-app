import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithAiUsageContext } from './ai-usage-context';
import { callAiJson, monthlyAiBudgetUsd, resolveAiApiKey, resolveAiModel } from './ai-json-parse';

function makeBudgetPrisma(spentMicros: number, reservedMicros = 0) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    aiUsageEvent: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { estimatedCostMicros: spentMicros } }),
      create: vi.fn().mockResolvedValue(undefined),
    },
    aiBudgetReservation: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { reservedCostMicros: reservedMicros } }),
      create: vi.fn().mockResolvedValue(undefined),
    },
  };
  return {
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    aiBudgetReservation: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    tx,
  };
}

describe('Gemini configuration', () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalBudget = process.env.AI_MONTHLY_VENUE_BUDGET_USD;
  const originalInputCost = process.env.AI_COST_INPUT_PER_MILLION_USD;
  const originalOutputCap = process.env.AI_MAX_OUTPUT_TOKENS;
  afterEach(() => {
    for (const [key, value] of Object.entries({
      GEMINI_API_KEY: originalKey,
      GEMINI_MODEL: originalModel,
      AI_MONTHLY_VENUE_BUDGET_USD: originalBudget,
      AI_COST_INPUT_PER_MILLION_USD: originalInputCost,
      AI_MAX_OUTPUT_TOKENS: originalOutputCap,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
  });

  it('uses only GEMINI_API_KEY', () => {
    process.env.GEMINI_API_KEY = 'gemini-key';
    expect(resolveAiApiKey()).toBe('gemini-key');
  });
  it('returns undefined with no Gemini key', () => {
    delete process.env.GEMINI_API_KEY;
    expect(resolveAiApiKey()).toBeUndefined();
  });
  it('prefers a feature model, then the global Gemini model, then fallback', () => {
    process.env.GEMINI_MODEL = 'global-model';
    expect(resolveAiModel('feature-model', 'fallback')).toBe('feature-model');
    expect(resolveAiModel(undefined, 'fallback')).toBe('global-model');
    delete process.env.GEMINI_MODEL;
    expect(resolveAiModel(undefined, 'fallback')).toBe('fallback');
  });

  it('defaults monthly AI budget to $10 when env is unset', () => {
    delete process.env.AI_MONTHLY_VENUE_BUDGET_USD;
    expect(monthlyAiBudgetUsd()).toBe(10);
  });

  it('blocks provider calls after a venue reaches its monthly AI budget', async () => {
    delete process.env.AI_MONTHLY_VENUE_BUDGET_USD;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const prisma = makeBudgetPrisma(10_000_000);

    await expect(runWithAiUsageContext(
      { venueId: 'venue-1', profileId: 'profile-1', prisma: prisma as any },
      () => callAiJson({ apiKey: 'key', model: 'gemini-flash-latest', prompt: 'Return JSON' }),
    )).rejects.toThrow('monthly AI usage budget');
    // Input tokens are now estimated locally, so an over-budget venue is
    // rejected without spending a provider round-trip at all.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.tx.aiBudgetReservation.create).not.toHaveBeenCalled();
  });

  it('reserves budget before calling the provider and clears it after recording usage', async () => {
    process.env.AI_MONTHLY_VENUE_BUDGET_USD = '25';
    const prisma = makeBudgetPrisma(0);
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      }), { status: 200 }));

    await expect(runWithAiUsageContext(
      { venueId: 'venue-1', profileId: 'profile-1', prisma: prisma as any },
      () => callAiJson({ apiKey: 'key', model: 'gemini-flash-latest', prompt: 'Return JSON' }),
    )).resolves.toEqual({ ok: true });
    expect(prisma.tx.aiBudgetReservation.create).toHaveBeenCalledOnce();
    expect(prisma.tx.aiUsageEvent.create).toHaveBeenCalledOnce();
    expect(prisma.tx.aiBudgetReservation.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ venueId: 'venue-1' }) }));
    // Exactly one provider round-trip: generateContent, with the output cap applied.
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toEqual(expect.stringContaining(':generateContent'));
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ body: expect.stringContaining('"maxOutputTokens":2048') });
  });

  it('fails closed before provider usage when AI pricing configuration is invalid', async () => {
    process.env.AI_COST_INPUT_PER_MILLION_USD = 'not-a-number';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(callAiJson({ apiKey: 'key', model: 'gemini-flash-latest', prompt: 'Return JSON' }))
      .rejects.toThrow('Invalid AI_COST_INPUT_PER_MILLION_USD configuration.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects malformed monthly budget configuration instead of treating it as unlimited', () => {
    process.env.AI_MONTHLY_VENUE_BUDGET_USD = 'NaN';
    expect(() => monthlyAiBudgetUsd()).toThrow('Invalid AI_MONTHLY_VENUE_BUDGET_USD configuration.');
  });
});
