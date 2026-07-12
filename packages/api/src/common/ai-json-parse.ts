import { BadRequestException } from '@nestjs/common';

// Shared JSON-mode call to an OpenRouter-hosted model (Gemini, Kimi, etc).
// Used anywhere we turn free-form text/photos into structured rows — bar
// inventory imports, staff roster imports, and future AI parsers.
export type AiJsonCallInput = {
  apiKey: string;
  model: string;
  prompt: string;
  userText?: string;
  imageBase64?: string;
  imageMimeType?: string;
};

export async function callAiJson(input: AiJsonCallInput): Promise<unknown> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }];
  if (input.userText) {
    content.push({ type: 'text', text: input.userText });
  }
  if (input.imageBase64) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${input.imageMimeType ?? 'image/jpeg'};base64,${input.imageBase64}` },
    });
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://venuewrangler.com',
      'X-Title': 'Venue Wrangler',
    },
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new BadRequestException('AI parsing failed. Try again or enter the details manually.');
  }
  const json: any = await response.json();
  const rawText = json?.choices?.[0]?.message?.content ?? '{}';
  try {
    return JSON.parse(rawText);
  } catch {
    throw new BadRequestException('AI parser returned invalid JSON. Try again with clearer input.');
  }
}

// Resolve the AI provider key/model with backward-compatible env var names —
// this used to be OpenAI-only; AI_API_KEY / AI_*_MODEL are the current names.
export function resolveAiApiKey(): string | undefined {
  return process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
}

export function resolveAiModel(specificEnvVar: string | undefined, fallback: string): string {
  return specificEnvVar || process.env.AI_MODEL || fallback;
}
