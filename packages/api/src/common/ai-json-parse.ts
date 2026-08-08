import { BadRequestException } from '@nestjs/common';

export type AiJsonCallInput = {
  apiKey: string;
  model: string;
  prompt: string;
  userText?: string;
  imageBase64?: string;
  imageMimeType?: string;
};

export type AiUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
};

export type AiJsonCallResult = {
  data: unknown;
  usage: AiUsage;
};

/** Calls Gemini in JSON mode and exposes provider usage for venue-level metering. */
export async function callAiJsonWithUsage(input: AiJsonCallInput): Promise<AiJsonCallResult> {
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
  if (input.userText) parts.push({ text: input.userText });
  if (input.imageBase64) parts.push({ inline_data: { mime_type: input.imageMimeType ?? 'image/jpeg', data: input.imageBase64 } });

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': input.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json' } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new BadRequestException('AI parsing failed. Try again or enter the details manually.');
  const json: any = await response.json();
  const rawText = json?.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join('') ?? '{}';
  let data: unknown;
  try { data = JSON.parse(rawText); } catch { throw new BadRequestException('AI parser returned invalid JSON. Try again with clearer input.'); }
  const metadata = json?.usageMetadata ?? {};
  const usage: AiUsage = {
    promptTokens: Number(metadata.promptTokenCount ?? 0),
    completionTokens: Number(metadata.candidatesTokenCount ?? 0),
    totalTokens: Number(metadata.totalTokenCount ?? 0),
    cachedTokens: Number(metadata.cachedContentTokenCount ?? 0),
  };
  return { data, usage };
}

/** Backward-compatible structured AI helper for features that do not meter yet. */
export async function callAiJson(input: AiJsonCallInput): Promise<unknown> {
  return (await callAiJsonWithUsage(input)).data;
}

export function resolveAiApiKey(): string | undefined { return process.env.GEMINI_API_KEY; }
export function resolveAiModel(specificEnvVar: string | undefined, fallback: string): string { return specificEnvVar || process.env.GEMINI_MODEL || fallback; }
