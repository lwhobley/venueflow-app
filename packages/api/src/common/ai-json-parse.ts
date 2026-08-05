import { BadRequestException } from '@nestjs/common';

export type AiJsonCallInput = {
  apiKey: string;
  model: string;
  prompt: string;
  userText?: string;
  imageBase64?: string;
  imageMimeType?: string;
};

/** Calls Gemini in JSON mode for every structured AI feature. */
export async function callAiJson(input: AiJsonCallInput): Promise<unknown> {
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
  if (input.userText) parts.push({ text: input.userText });
  if (input.imageBase64) {
    parts.push({ inline_data: { mime_type: input.imageMimeType ?? 'image/jpeg', data: input.imageBase64 } });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': input.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new BadRequestException('AI parsing failed. Try again or enter the details manually.');
  const json: any = await response.json();
  const rawText = json?.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join('') ?? '{}';
  try {
    return JSON.parse(rawText);
  } catch {
    throw new BadRequestException('AI parser returned invalid JSON. Try again with clearer input.');
  }
}

export function resolveAiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY;
}

export function resolveAiModel(specificEnvVar: string | undefined, fallback: string): string {
  return specificEnvVar || process.env.GEMINI_MODEL || fallback;
}
