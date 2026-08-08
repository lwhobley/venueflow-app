import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { currentAiUsageContext } from './ai-usage-context';

export type AiJsonCallInput = { apiKey: string; model: string; prompt: string; userText?: string; imageBase64?: string; imageMimeType?: string; feature?: string };
export type AiUsage = { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number };
export type AiJsonCallResult = { data: unknown; usage: AiUsage };

function estimatedCostMicros(model: string, usage: AiUsage): number {
  const name = model.toLowerCase();
  // Conservative configurable estimates. Override as provider pricing changes.
  const inputPerMillion = Number(process.env.AI_COST_INPUT_PER_MILLION_USD ?? (name.includes('flash-lite') ? 0.25 : 1.5));
  const outputPerMillion = Number(process.env.AI_COST_OUTPUT_PER_MILLION_USD ?? (name.includes('flash-lite') ? 1.5 : 9));
  const billablePrompt = Math.max(0, usage.promptTokens - usage.cachedTokens);
  return Math.round(((billablePrompt * inputPerMillion + usage.completionTokens * outputPerMillion) / 1_000_000) * 1_000_000);
}

async function meter(input: AiJsonCallInput, usage: AiUsage) {
  const context = currentAiUsageContext();
  if (!context) return;
  const cost = estimatedCostMicros(input.model, usage);
  try {
    await context.prisma.$executeRawUnsafe(
      `INSERT INTO "AiUsageEvent" ("id","venueId","profileId","feature","provider","model","promptTokens","completionTokens","cachedTokens","totalTokens","estimatedCostMicros","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      randomUUID(), context.venueId, context.profileId, input.feature ?? 'structured_ai', 'gemini', input.model, usage.promptTokens, usage.completionTokens, usage.cachedTokens, usage.totalTokens, cost,
    );
  } catch (error) {
    // Metering must never take down an operational AI request.
    console.error('AI usage metering failed', error);
  }
}

export async function callAiJsonWithUsage(input: AiJsonCallInput): Promise<AiJsonCallResult> {
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
  if (input.userText) parts.push({ text: input.userText });
  if (input.imageBase64) parts.push({ inline_data: { mime_type: input.imageMimeType ?? 'image/jpeg', data: input.imageBase64 } });
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': input.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json' } }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new BadRequestException('AI parsing failed. Try again or enter the details manually.');
  const json: any = await response.json();
  const rawText = json?.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join('') ?? '{}';
  let data: unknown;
  try { data = JSON.parse(rawText); } catch { throw new BadRequestException('AI parser returned invalid JSON. Try again with clearer input.'); }
  const metadata = json?.usageMetadata ?? {};
  const usage: AiUsage = { promptTokens: Number(metadata.promptTokenCount ?? 0), completionTokens: Number(metadata.candidatesTokenCount ?? 0), totalTokens: Number(metadata.totalTokenCount ?? 0), cachedTokens: Number(metadata.cachedContentTokenCount ?? 0) };
  await meter(input, usage);
  return { data, usage };
}

export async function callAiJson(input: AiJsonCallInput): Promise<unknown> { return (await callAiJsonWithUsage(input)).data; }
export function resolveAiApiKey(): string | undefined { return process.env.GEMINI_API_KEY; }
export function resolveAiModel(specificEnvVar: string | undefined, fallback: string): string { return specificEnvVar || process.env.GEMINI_MODEL || fallback; }
