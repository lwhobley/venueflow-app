import { BadRequestException, Injectable } from '@nestjs/common';

const CATEGORIES = ['spirit', 'wine', 'beer', 'mixer', 'garnish', 'supply', 'other'] as const;
const MAX_IMPORT_ITEMS = 100;
const MAX_PARSE_TEXT_CHARS = 20_000;
const MAX_IMAGE_BASE64_CHARS = 6_000_000;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

type ParseInput = {
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
};

export type ParsedInventoryResult = {
  notes: string;
  items: Array<{
    name: string;
    category: (typeof CATEGORIES)[number];
    area?: string;
    unit: string;
    parLevel: number;
    onHand: number;
    unitCostCents: number;
    supplier?: string;
    sku?: string;
    notes?: string;
  }>;
};

@Injectable()
export class BarInventoryParserService {
  async parse(input: ParseInput): Promise<ParsedInventoryResult> {
    // Prefer AI_API_KEY (the current standard, shared with the scheduler and
    // staff-import AI features) but keep OPENAI_API_KEY as a fallback for
    // either provider shape — unlike ai-json-parse.ts's resolveAiApiKey(),
    // this service genuinely supports real OpenAI keys (see parseWithOpenAi
    // below), so it can't discard non-OpenRouter-shaped legacy keys.
    const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new BadRequestException('AI parsing requires AI_API_KEY configuration');

    const inputText = input.text?.trim() ?? '';
    if (!inputText && !input.imageBase64) {
      throw new BadRequestException('Add pasted text, a CSV/list upload, or a photo to parse');
    }
    if (inputText.length > MAX_PARSE_TEXT_CHARS) {
      throw new BadRequestException(
        `Text imports are limited to ${MAX_PARSE_TEXT_CHARS.toLocaleString()} characters`,
      );
    }
    if (input.imageBase64 && input.imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
      throw new BadRequestException('Photo imports are limited to about 4.5MB');
    }

    const imageMimeType = input.imageMimeType ?? 'image/jpeg';
    if (input.imageBase64 && !ALLOWED_IMAGE_MIME_TYPES.has(imageMimeType)) {
      throw new BadRequestException('Photo imports must be JPEG, PNG, WebP, HEIC, or HEIF');
    }

    const parsed = apiKey.startsWith('sk-or-')
      ? await this.parseWithOpenRouter(apiKey, inputText, input.imageBase64, imageMimeType)
      : await this.parseWithOpenAi(apiKey, inputText, input.imageBase64, imageMimeType);

    return this.normalizeParsedInventory(parsed);
  }

  normalizeParsedInventory(parsed: unknown): ParsedInventoryResult {
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { items?: unknown }).items)) {
      throw new BadRequestException('AI inventory parser returned invalid JSON. Try again with a clearer image or text input.');
    }

    const raw = parsed as { notes?: unknown; items: unknown[] };
    return {
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      items: raw.items.slice(0, MAX_IMPORT_ITEMS).map((item) => {
        const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const category = row.category;
        return {
          name: String(row.name ?? ''),
          category: CATEGORIES.includes(category as (typeof CATEGORIES)[number])
            ? category as (typeof CATEGORIES)[number]
            : 'other',
          area: cleanText(row.area),
          unit: String(row.unit || 'unit'),
          parLevel: Number(row.parLevel || 0),
          onHand: Number(row.onHand || 0),
          unitCostCents: Number(row.unitCostCents || 0),
          supplier: cleanText(row.supplier),
          sku: cleanText(row.sku),
          notes: cleanText(row.notes),
        };
      }),
    };
  }

  private async parseWithOpenRouter(
    apiKey: string,
    inputText: string,
    imageBase64: string | undefined,
    imageMimeType: string,
  ) {
    const model = process.env.OPENAI_INVENTORY_MODEL ?? 'meta-llama/llama-3.2-11b-vision-instruct:free';
    const promptContent: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: `Extract bar inventory items from this input. Return only bar stock items. Infer reasonable categories from: spirit, wine, beer, mixer, garnish, supply, other. Unit examples: bottle, case, keg, can, each, liter. Prices should be cents when present. Return STRICT JSON matching schema: {"notes": "string", "items": [{"name": "string", "category": "spirit|wine|beer|mixer|garnish|supply|other", "area": "string", "unit": "string", "parLevel": number, "onHand": number, "unitCostCents": number, "supplier": "string", "sku": "string", "notes": "string"}]}`,
      },
    ];
    if (inputText) {
      promptContent.push({ type: 'text', text: inputText });
    }
    if (imageBase64) {
      promptContent.push({
        type: 'image_url',
        image_url: {
          url: `data:${imageMimeType};base64,${imageBase64}`,
        },
      });
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://venue-wrangler.pages.dev',
        'X-Title': 'Venue Wrangler',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: promptContent }],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const json: any = await response.json();
    if (!response.ok) {
      throw new BadRequestException('Inventory parse failed. Try again or enter the items manually.');
    }
    return this.parseAiInventoryJson(json?.choices?.[0]?.message?.content ?? '{"notes":"","items":[]}');
  }

  private async parseWithOpenAi(
    apiKey: string,
    inputText: string,
    imageBase64: string | undefined,
    imageMimeType: string,
  ) {
    const content: Array<Record<string, unknown>> = [
      {
        type: 'input_text',
        text: `Extract bar inventory items from this input. Return only bar stock items. Infer reasonable categories from: spirit, wine, beer, mixer, garnish, supply, other. Unit examples: bottle, case, keg, can, each, liter. Prices should be cents when present.\n\n${inputText}`,
      },
    ];
    if (imageBase64) {
      content.push({
        type: 'input_image',
        image_url: `data:${imageMimeType};base64,${imageBase64}`,
        detail: 'high',
      });
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_INVENTORY_MODEL ?? 'gpt-4.1-mini',
        input: [{ role: 'user', content }],
        text: {
          format: {
            type: 'json_schema',
            name: 'bar_inventory_import',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                notes: { type: 'string' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      name: { type: 'string' },
                      category: {
                        type: 'string',
                        enum: ['spirit', 'wine', 'beer', 'mixer', 'garnish', 'supply', 'other'],
                      },
                      area: { type: 'string' },
                      unit: { type: 'string' },
                      parLevel: { type: 'number' },
                      onHand: { type: 'number' },
                      unitCostCents: { type: 'number' },
                      supplier: { type: 'string' },
                      sku: { type: 'string' },
                      notes: { type: 'string' },
                    },
                    required: ['name', 'category', 'unit'],
                  },
                },
              },
              required: ['notes', 'items'],
            },
          },
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    const json: any = await response.json();
    if (!response.ok) {
      throw new BadRequestException('Inventory parse failed. Try again or enter the items manually.');
    }
    const outputText =
      json.output_text ??
      json.output
        ?.flatMap((part: any) => part.content ?? [])
        .find((part: any) => part.type === 'output_text')?.text;
    return this.parseAiInventoryJson(outputText ?? '{"notes":"No output","items":[]}');
  }

  private parseAiInventoryJson(rawText: string) {
    try {
      return JSON.parse(rawText);
    } catch {
      throw new BadRequestException('AI inventory parser returned invalid JSON. Try again with a clearer image or text input.');
    }
  }
}

function cleanText(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
}
