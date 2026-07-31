import { afterEach, describe, expect, it } from 'vitest';
import { resolveAiApiKey, resolveAiModel } from './ai-json-parse';

describe('resolveAiApiKey', () => {
  const originalAiKey = process.env.AI_API_KEY;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    process.env.AI_API_KEY = originalAiKey;
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  });

  it('prefers AI_API_KEY over the legacy OPENAI_API_KEY name', () => {
    process.env.AI_API_KEY = 'sk-or-new';
    process.env.OPENAI_API_KEY = 'sk-or-legacy';
    expect(resolveAiApiKey()).toBe('sk-or-new');
  });

  it('falls back to OPENAI_API_KEY when AI_API_KEY is unset', () => {
    delete process.env.AI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-or-legacy';
    expect(resolveAiApiKey()).toBe('sk-or-legacy');
  });

  it('returns undefined when neither is set', () => {
    delete process.env.AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(resolveAiApiKey()).toBeUndefined();
  });

  it('refuses a legacy OPENAI_API_KEY that is not OpenRouter-shaped, so a real OpenAI key never gets forwarded to OpenRouter', () => {
    delete process.env.AI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-proj-a-real-openai-key';
    expect(resolveAiApiKey()).toBeUndefined();
  });
});

describe('resolveAiModel', () => {
  const originalGlobalModel = process.env.AI_MODEL;

  afterEach(() => {
    process.env.AI_MODEL = originalGlobalModel;
  });

  it('prefers a feature-specific env var over the global default', () => {
    delete process.env.AI_MODEL;
    expect(resolveAiModel('specific/model', 'fallback/model')).toBe('specific/model');
  });

  it('falls back to the global AI_MODEL when no feature-specific value is set', () => {
    process.env.AI_MODEL = 'global/model';
    expect(resolveAiModel(undefined, 'fallback/model')).toBe('global/model');
  });

  it('falls back to the hardcoded default when nothing is configured', () => {
    delete process.env.AI_MODEL;
    expect(resolveAiModel(undefined, 'fallback/model')).toBe('fallback/model');
  });
});
