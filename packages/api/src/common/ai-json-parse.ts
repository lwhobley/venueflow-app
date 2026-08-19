import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { currentAiUsageContext } from './ai-usage-context';

export type AiJsonCallInput = { apiKey: string; model: string; prompt: string; userText?: string; imageBase64?: string; imageMimeType?: string; feature?: string };
export type AiUsage = { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number };
export type AiJsonCallResult = { data: unknown; usage: AiUsage };

const MICROS_PER_USD = 1_000_000;
const DEFAULT_MONTHLY_BUDGET_USD = 10;
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const DEFAULT_RESERVATION_TTL_SECONDS = 120;

type BudgetReservation = { id: string; venueId: string };

function finiteNonNegativeEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new HttpException(`Invalid ${key} configuration.`, HttpStatus.SERVICE_UNAVAILABLE);
  }
  return value;
}

function finitePositiveEnv(key: string, fallback: number): number {
  const value = finiteNonNegativeEnv(key, fallback);
  if (value <= 0) {
    throw new HttpException(`Invalid ${key} configuration.`, HttpStatus.SERVICE_UNAVAILABLE);
  }
  return value;
}

export function monthlyAiBudgetUsd(): number {
  return finiteNonNegativeEnv('AI_MONTHLY_VENUE_BUDGET_USD', DEFAULT_MONTHLY_BUDGET_USD);
}

export function aiBudgetWarningPercent(): number {
  const value = finitePositiveEnv('AI_MONTHLY_VENUE_WARNING_PERCENT', 80);
  if (value > 100) {
    throw new HttpException('Invalid AI_MONTHLY_VENUE_WARNING_PERCENT configuration.', HttpStatus.SERVICE_UNAVAILABLE);
  }
  return value;
}

function monthlyAiBudgetMicros(): number {
  return Math.round(monthlyAiBudgetUsd() * MICROS_PER_USD);
}

function maxOutputTokens(): number {
  const raw = finitePositiveEnv('AI_MAX_OUTPUT_TOKENS', DEFAULT_MAX_OUTPUT_TOKENS);
  if (!Number.isInteger(raw)) {
    throw new HttpException('Invalid AI_MAX_OUTPUT_TOKENS configuration.', HttpStatus.SERVICE_UNAVAILABLE);
  }
  return raw;
}

function reservationTtlMs(): number {
  return Math.round(finitePositiveEnv('AI_BUDGET_RESERVATION_TTL_SECONDS', DEFAULT_RESERVATION_TTL_SECONDS) * 1000);
}

function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function estimatedCostMicros(model: string, usage: AiUsage): number {
  const name = model.toLowerCase();
  // Conservative configurable estimates. Override as provider pricing changes.
  const inputPerMillion = finiteNonNegativeEnv('AI_COST_INPUT_PER_MILLION_USD', name.includes('flash-lite') ? 0.25 : 1.5);
  const outputPerMillion = finiteNonNegativeEnv('AI_COST_OUTPUT_PER_MILLION_USD', name.includes('flash-lite') ? 1.5 : 9);
  const billablePrompt = Math.max(0, usage.promptTokens - usage.cachedTokens);
  return Math.round(billablePrompt * inputPerMillion + usage.completionTokens * outputPerMillion);
}

async function meter(input: AiJsonCallInput, usage: AiUsage, reservation: BudgetReservation | null): Promise<boolean> {
  const context = currentAiUsageContext();
  if (!context) return true;
  const cost = estimatedCostMicros(input.model, usage);
  try {
    await context.prisma.$transaction(async (tx) => {
      await tx.aiUsageEvent.create({
        data: {
          id: randomUUID(), venueId: context.venueId, profileId: context.profileId,
          feature: input.feature ?? 'structured_ai', provider: 'gemini', model: input.model,
          promptTokens: usage.promptTokens, completionTokens: usage.completionTokens,
          cachedTokens: usage.cachedTokens, totalTokens: usage.totalTokens, estimatedCostMicros: cost,
        },
      });
      if (reservation) {
        await tx.aiBudgetReservation.deleteMany({ where: { id: reservation.id, venueId: context.venueId } });
      }
    });
    return true;
  } catch (error) {
    // Leave a failed meter's reservation in place until it expires. This fails
    // closed for the budget without taking down an operational AI request.
    console.error('AI usage metering failed', error);
    return false;
  }
}

async function reserveMonthlyVenueBudget(reservationCost: number): Promise<BudgetReservation | null> {
  if (monthlyAiBudgetUsd() === 0 || reservationCost === 0) return null;
  const context = currentAiUsageContext();
  if (!context) {
    // Every current AI caller (staff import, bar-inventory parsing, the
    // scheduler, and the Wrangler operator) runs behind VenueScopeInterceptor,
    // which always binds this context. A call reaching here with no context
    // bound — e.g. a future AI call added to a route decorated
    // @SkipVenueScope — would otherwise run completely unmetered and outside
    // the venue's monthly budget with no error at all. Fail closed instead of
    // silently skipping enforcement.
    throw new HttpException('AI usage could not be attributed to a venue and was blocked.', HttpStatus.INTERNAL_SERVER_ERROR);
  }
  const now = new Date();
  const monthStart = utcMonthStart(now);
  const budget = monthlyAiBudgetMicros();
  const reservation = { id: randomUUID(), venueId: context.venueId };

  await context.prisma.$transaction(async (tx) => {
    // Transactions are short: the lock protects only cleanup/check/reserve,
    // never the remote provider request.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${context.venueId}:${monthStart.toISOString()}`}))`;
    await tx.aiBudgetReservation.deleteMany({ where: { venueId: context.venueId, expiresAt: { lte: now } } });
    const [usage, pending] = await Promise.all([
      tx.aiUsageEvent.aggregate({ where: { venueId: context.venueId, createdAt: { gte: monthStart } }, _sum: { estimatedCostMicros: true } }),
      tx.aiBudgetReservation.aggregate({ where: { venueId: context.venueId, expiresAt: { gt: now } }, _sum: { reservedCostMicros: true } }),
    ]);
    const spent = usage._sum.estimatedCostMicros ?? 0;
    const reserved = pending._sum.reservedCostMicros ?? 0;
    if (spent + reserved + reservationCost > budget) {
      throw new HttpException('This venue has reached its monthly AI usage budget.', HttpStatus.TOO_MANY_REQUESTS);
    }
    await tx.aiBudgetReservation.create({
      data: { ...reservation, reservedCostMicros: reservationCost, expiresAt: new Date(now.getTime() + reservationTtlMs()) },
    });
  });
  return reservation;
}

async function countInputTokens(input: AiJsonCallInput, parts: Array<Record<string, unknown>>): Promise<number> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:countTokens`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': input.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new BadRequestException('AI parsing is temporarily unavailable. Try again or enter the details manually.');
  }
  const body: unknown = await response.json();
  const totalTokens = (body as { totalTokens?: unknown })?.totalTokens;
  if (typeof totalTokens !== 'number' || !Number.isSafeInteger(totalTokens) || totalTokens < 0) {
    throw new BadRequestException('AI parsing is temporarily unavailable. Try again or enter the details manually.');
  }
  return totalTokens;
}

async function releaseReservation(reservation: BudgetReservation | null): Promise<void> {
  const context = currentAiUsageContext();
  if (!context || !reservation) return;
  await context.prisma.aiBudgetReservation.deleteMany({ where: { id: reservation.id, venueId: context.venueId } }).catch((error) => {
    console.error('AI budget reservation release failed', error);
  });
}

export async function callAiJsonWithUsage(input: AiJsonCallInput): Promise<AiJsonCallResult> {
  // Validate operator pricing before consuming provider quota. A malformed
  // price must fail closed rather than turn a later metering write into a
  // swallowed error after the paid request has already completed.
  estimatedCostMicros(input.model, { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 });
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
  if (input.userText) parts.push({ text: input.userText });
  if (input.imageBase64) parts.push({ inline_data: { mime_type: input.imageMimeType ?? 'image/jpeg', data: input.imageBase64 } });
  // Count the exact multimodal input first, then reserve its configured
  // maximum output cost. The generation request applies the same output cap.
  const inputTokens = await countInputTokens(input, parts);
  const outputCap = maxOutputTokens();
  const reservation = await reserveMonthlyVenueBudget(estimatedCostMicros(input.model, {
    promptTokens: inputTokens, completionTokens: outputCap, totalTokens: inputTokens + outputCap, cachedTokens: 0,
  }));
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': input.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: outputCap } }), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new BadRequestException('AI parsing failed. Try again or enter the details manually.');
    const json: any = await response.json();
    const rawText = json?.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join('') ?? '{}';
    let data: unknown;
    try { data = JSON.parse(rawText); } catch { throw new BadRequestException('AI parser returned invalid JSON. Try again with clearer input.'); }
    const metadata = json?.usageMetadata ?? {};
    const usage: AiUsage = { promptTokens: Number(metadata.promptTokenCount ?? 0), completionTokens: Number(metadata.candidatesTokenCount ?? 0), totalTokens: Number(metadata.totalTokenCount ?? 0), cachedTokens: Number(metadata.cachedContentTokenCount ?? 0) };
    await meter(input, usage, reservation);
    return { data, usage };
  } catch (error) {
    await releaseReservation(reservation);
    throw error;
  }
}

export async function callAiJson(input: AiJsonCallInput): Promise<unknown> { return (await callAiJsonWithUsage(input)).data; }
export function resolveAiApiKey(): string | undefined { return process.env.GEMINI_API_KEY; }
export function resolveAiModel(specificEnvVar: string | undefined, fallback: string): string { return specificEnvVar || process.env.GEMINI_MODEL || fallback; }
