import { BadRequestException, Injectable } from '@nestjs/common';
import { callAiJson, resolveAiApiKey, resolveAiModel } from '../../common/ai-json-parse';

const CATEGORIES = ['spirit', 'wine', 'beer', 'mixer', 'garnish', 'supply', 'other'] as const;
const MAX_IMPORT_ITEMS = 100;
const MAX_PARSE_TEXT_CHARS = 20_000;
const MAX_IMAGE_BASE64_CHARS = 6_000_000;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

type ParseInput = { text?: string; imageBase64?: string; imageMimeType?: string };
export type ParsedInventoryResult = { notes: string; items: Array<{ name: string; category: (typeof CATEGORIES)[number]; area?: string; unit: string; parLevel: number; onHand: number; unitCostCents: number; supplier?: string; sku?: string; notes?: string }> };

const PROMPT = `Extract bar inventory items from this input. Return only bar stock items. Infer categories from spirit, wine, beer, mixer, garnish, supply, other. Unit examples: bottle, case, keg, can, each, liter. Prices must be cents. Return STRICT JSON matching {"notes":"string","items":[{"name":"string","category":"spirit|wine|beer|mixer|garnish|supply|other","area":"string","unit":"string","parLevel":number,"onHand":number,"unitCostCents":number,"supplier":"string","sku":"string","notes":"string"}]}.`;

@Injectable()
export class BarInventoryParserService {
  async parse(input: ParseInput): Promise<ParsedInventoryResult> {
    const apiKey = resolveAiApiKey();
    if (!apiKey) throw new BadRequestException('AI parsing requires GEMINI_API_KEY configuration');
    const text = input.text?.trim() ?? '';
    if (!text && !input.imageBase64) throw new BadRequestException('Add pasted text, a CSV/list upload, or a photo to parse');
    if (text.length > MAX_PARSE_TEXT_CHARS) throw new BadRequestException(`Text imports are limited to ${MAX_PARSE_TEXT_CHARS.toLocaleString()} characters`);
    if (input.imageBase64 && input.imageBase64.length > MAX_IMAGE_BASE64_CHARS) throw new BadRequestException('Photo imports are limited to about 4.5MB');
    const imageMimeType = input.imageMimeType ?? 'image/jpeg';
    if (input.imageBase64 && !ALLOWED_IMAGE_MIME_TYPES.has(imageMimeType)) throw new BadRequestException('Photo imports must be JPEG, PNG, WebP, HEIC, or HEIF');
    const parsed = await callAiJson({ apiKey, model: resolveAiModel(process.env.GEMINI_INVENTORY_MODEL, 'gemini-flash-latest'), prompt: PROMPT, userText: text || undefined, imageBase64: input.imageBase64, imageMimeType });
    return this.normalizeParsedInventory(parsed);
  }

  normalizeParsedInventory(parsed: unknown): ParsedInventoryResult {
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { items?: unknown }).items)) throw new BadRequestException('AI inventory parser returned invalid JSON. Try again with a clearer image or text input.');
    const raw = parsed as { notes?: unknown; items: unknown[] };
    return { notes: typeof raw.notes === 'string' ? raw.notes : '', items: raw.items.slice(0, MAX_IMPORT_ITEMS).map((item) => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const category = row.category;
      return { name: String(row.name ?? ''), category: CATEGORIES.includes(category as (typeof CATEGORIES)[number]) ? category as (typeof CATEGORIES)[number] : 'other', area: cleanText(row.area), unit: String(row.unit || 'unit'), parLevel: Number(row.parLevel || 0), onHand: Number(row.onHand || 0), unitCostCents: Number(row.unitCostCents || 0), supplier: cleanText(row.supplier), sku: cleanText(row.sku), notes: cleanText(row.notes) };
    }) };
  }
}

function cleanText(value: unknown): string | undefined { const trimmed = typeof value === 'string' ? value.trim() : ''; return trimmed || undefined; }
