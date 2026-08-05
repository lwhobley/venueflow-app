import { afterEach, describe, expect, it } from 'vitest';
import { resolveAiApiKey, resolveAiModel } from './ai-json-parse';

describe('Gemini configuration', () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  afterEach(() => { process.env.GEMINI_API_KEY = originalKey; process.env.GEMINI_MODEL = originalModel; });

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
});
