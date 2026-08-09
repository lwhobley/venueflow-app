import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithAiUsageContext } from './ai-usage-context';
import { callAiJson, resolveAiApiKey, resolveAiModel } from './ai-json-parse';

describe('Gemini configuration', () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalBudget = process.env.AI_MONTHLY_VENUE_BUDGET_USD;
  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
    process.env.GEMINI_MODEL = originalModel;
    process.env.AI_MONTHLY_VENUE_BUDGET_USD = originalBudget;
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

  it('blocks provider calls after a venue reaches its monthly AI budget', async () => {
    process.env.AI_MONTHLY_VENUE_BUDGET_USD = '25';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const prisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ estimatedCostMicros: 25_000_000n }]),
    } as any;

    await expect(runWithAiUsageContext(
      { venueId: 'venue-1', profileId: 'profile-1', prisma },
      () => callAiJson({ apiKey: 'key', model: 'gemini-flash-latest', prompt: 'Return JSON' }),
    )).rejects.toThrow('monthly AI usage budget');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
