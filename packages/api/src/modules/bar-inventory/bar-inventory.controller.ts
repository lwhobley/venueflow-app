import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';

const CATEGORIES = ['spirit', 'wine', 'beer', 'mixer', 'garnish', 'supply', 'other'] as const;
const MOVEMENT_TYPES = ['count', 'received', 'waste', 'comp', 'transfer', 'correction'] as const;
const MAX_IMPORT_ITEMS = 100;
const MAX_PARSE_TEXT_CHARS = 20_000;
const MAX_IMAGE_BASE64_CHARS = 6_000_000;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

type BarStockCategory = (typeof CATEGORIES)[number];
type BarStockMovementType = (typeof MOVEMENT_TYPES)[number];

class UpsertBarItemDto {
  @IsString()
  @IsOptional()
  itemId?: string;

  @IsString()
  name!: string;

  @IsIn(CATEGORIES)
  category!: BarStockCategory;

  @IsString()
  @IsOptional()
  area?: string;

  @IsString()
  unit!: string;

  @IsNumber()
  @Min(0)
  parLevel!: number;

  @IsNumber()
  @Min(0)
  onHand!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitCostCents?: number;

  @IsString()
  @IsOptional()
  supplier?: string;

  @IsString()
  @IsOptional()
  sku?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

class RecordMovementDto {
  @IsIn(MOVEMENT_TYPES)
  movementType!: BarStockMovementType;

  @IsNumber()
  quantity!: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

class ParsedItemDto {
  @IsString()
  name!: string;

  @IsIn(CATEGORIES)
  category!: BarStockCategory;

  @IsString()
  @IsOptional()
  area?: string;

  @IsString()
  unit!: string;

  @IsNumber()
  @IsOptional()
  parLevel?: number;

  @IsNumber()
  @IsOptional()
  onHand?: number;

  @IsNumber()
  @IsOptional()
  unitCostCents?: number;

  @IsString()
  @IsOptional()
  supplier?: string;

  @IsString()
  @IsOptional()
  sku?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

class ImportParsedBarItemsDto {
  @IsArray()
  @ArrayMaxSize(MAX_IMPORT_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ParsedItemDto)
  items!: ParsedItemDto[];
}

class ParseBarInventoryInputDto {
  @IsString()
  @IsOptional()
  text?: string;

  @IsString()
  @IsOptional()
  imageBase64?: string;

  @IsString()
  @IsOptional()
  imageMimeType?: string;
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseAiInventoryJson(rawText: string) {
  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
      throw new Error('Invalid inventory parse shape');
    }
    return parsed;
  } catch {
    throw new BadRequestException('AI inventory parser returned invalid JSON. Try again with a clearer image or text input.');
  }
}

function toMs(date: Date | null | undefined): number | null {
  return date ? date.getTime() : null;
}

function mapItem(item: {
  id: string;
  venueId: string;
  name: string;
  category: string;
  area: string | null;
  unit: string;
  parLevel: number;
  onHand: number;
  unitCostCents: number | null;
  supplier: string | null;
  sku: string | null;
  notes: string | null;
  lastCountedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: item.id,
    venueId: item.venueId,
    name: item.name,
    category: item.category,
    area: item.area ?? null,
    unit: item.unit,
    parLevel: item.parLevel,
    onHand: item.onHand,
    unitCostCents: item.unitCostCents ?? null,
    supplier: item.supplier ?? null,
    sku: item.sku ?? null,
    notes: item.notes ?? null,
    lastCountedAt: toMs(item.lastCountedAt),
    createdAt: item.createdAt.getTime(),
    updatedAt: item.updatedAt.getTime(),
  };
}

@Controller('v1/bar-inventory')
@UseGuards(AuthGuard)
export class BarInventoryController {
  constructor(private readonly prisma: PrismaService) {}

  @RequireSubscription('active')
  @Get()
  async getBarStock(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const items = await this.prisma.barInventoryItem.findMany({
      where: { venueId: profile.venueId! },
      take: 300,
    });
    const sorted = items.slice().sort((a, b) => a.name.localeCompare(b.name));
    return {
      items: sorted.map(mapItem),
      lowStockCount: items.filter((item) => item.onHand <= item.parLevel).length,
      totalValueCents: items.reduce(
        (sum, item) => sum + Math.round(item.onHand * (item.unitCostCents ?? 0)),
        0,
      ),
    };
  }

  @RequireSubscription('active')
  @Post()
  async upsertBarItem(@CurrentUser() user: AuthUser, @Body() body: UpsertBarItemDto) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const now = new Date();
    const name = body.name.trim();
    if (!name) throw new BadRequestException('Item name is required');
    const payload = {
      venueId,
      name,
      category: body.category,
      area: cleanText(body.area) ?? null,
      unit: body.unit.trim() || 'unit',
      parLevel: Math.max(0, body.parLevel),
      onHand: Math.max(0, body.onHand),
      unitCostCents:
        body.unitCostCents === undefined ? null : Math.max(0, Math.round(body.unitCostCents)),
      supplier: cleanText(body.supplier) ?? null,
      sku: cleanText(body.sku) ?? null,
      notes: cleanText(body.notes) ?? null,
      updatedAt: now,
    };
    if (body.itemId) {
      const existing = await this.prisma.barInventoryItem.findFirst({
        where: { id: body.itemId, venueId },
      });
      if (!existing) throw new NotFoundException('Item not found');
      const updated = await this.prisma.barInventoryItem.update({
        where: { id: existing.id },
        data: payload,
      });
      return mapItem(updated);
    }
    const created = await this.prisma.barInventoryItem.create({
      data: { ...payload, createdAt: now },
    });
    return mapItem(created);
  }

  @RequireSubscription('active')
  @Post(':id/movement')
  async recordBarStockMovement(
    @CurrentUser() user: AuthUser,
    @Param('id') itemId: string,
    @Body() body: RecordMovementDto,
  ) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const movement = await this.prisma.$transaction(async (tx) => {
      const item = await tx.barInventoryItem.findFirst({ where: { id: itemId, venueId } });
      if (!item) throw new NotFoundException('Item not found');
      const previousOnHand = item.onHand;
      const nextOnHand =
        body.movementType === 'count'
          ? Math.max(0, body.quantity)
          : Math.max(0, previousOnHand + body.quantity);
      const now = new Date();
      await tx.barInventoryItem.update({
        where: { id: item.id },
        data: {
          onHand: nextOnHand,
          lastCountedAt: body.movementType === 'count' ? now : item.lastCountedAt,
          updatedAt: now,
        },
      });
      return tx.barInventoryMovement.create({
        data: {
          venueId,
          itemId: item.id,
          movementType: body.movementType,
          quantity: body.quantity,
          previousOnHand,
          nextOnHand,
          notes: cleanText(body.notes) ?? null,
          createdBy: profile.id,
          createdAt: now,
        },
      });
    });
    return { _id: movement.id };
  }

  @RequireSubscription('active')
  @Post('import')
  async importParsedBarItems(@CurrentUser() user: AuthUser, @Body() body: ImportParsedBarItemsDto) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const items = body.items ?? [];
    const existingRows = await this.prisma.barInventoryItem.findMany({
      where: { venueId },
      take: 500,
    });
    const existingByName = new Map(existingRows.map((row) => [row.name.toLowerCase(), row]));
    const seenNames = new Set<string>();
    const writes = [];
    let imported = 0;
    for (const item of items.slice(0, MAX_IMPORT_ITEMS)) {
      const name = item.name?.trim() ?? '';
      if (!name) continue;
      const nameKey = name.toLowerCase();
      if (seenNames.has(nameKey)) continue;
      seenNames.add(nameKey);
      const now = new Date();
      const payload = {
        venueId,
        name,
        category: item.category,
        area: cleanText(item.area) ?? null,
        unit: item.unit?.trim() || 'unit',
        parLevel: Math.max(0, item.parLevel ?? 0),
        onHand: Math.max(0, item.onHand ?? 0),
        unitCostCents:
          item.unitCostCents === undefined ? null : Math.max(0, Math.round(item.unitCostCents)),
        supplier: cleanText(item.supplier) ?? null,
        sku: cleanText(item.sku) ?? null,
        notes: cleanText(item.notes) ?? null,
        updatedAt: now,
      };
      const existing = existingByName.get(nameKey);
      if (existing) {
        writes.push(this.prisma.barInventoryItem.update({ where: { id: existing.id }, data: payload }));
      } else {
        writes.push(this.prisma.barInventoryItem.create({ data: { ...payload, createdAt: now } }));
      }
      imported += 1;
    }
    if (writes.length) {
      await this.prisma.$transaction(writes);
    }
    return { imported };
  }

  @RequireSubscription('active')
  @Post('parse')
  async parseBarInventoryInput(
    @CurrentUser() user: AuthUser,
    @Body() body: ParseBarInventoryInputDto,
  ) {
    await this.requireManagerProfile(user);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new BadRequestException('AI parsing requires OPENAI_API_KEY configuration');
    const inputText = body.text?.trim() ?? '';
    if (!inputText && !body.imageBase64) {
      throw new BadRequestException('Add pasted text, a CSV/list upload, or a photo to parse');
    }
    if (inputText.length > MAX_PARSE_TEXT_CHARS) {
      throw new BadRequestException(
        `Text imports are limited to ${MAX_PARSE_TEXT_CHARS.toLocaleString()} characters`,
      );
    }
    if (body.imageBase64 && body.imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
      throw new BadRequestException('Photo imports are limited to about 4.5MB');
    }
    const imageMimeType = body.imageMimeType ?? 'image/jpeg';
    if (body.imageBase64 && !ALLOWED_IMAGE_MIME_TYPES.has(imageMimeType)) {
      throw new BadRequestException('Photo imports must be JPEG, PNG, WebP, HEIC, or HEIF');
    }

    let parsed: any;
    if (apiKey.startsWith('sk-or-')) {
      const model = process.env.OPENAI_INVENTORY_MODEL ?? 'meta-llama/llama-3.2-11b-vision-instruct:free';
      const promptContent: any[] = [
        {
          type: 'text',
          text: `Extract bar inventory items from this input. Return only bar stock items. Infer reasonable categories from: spirit, wine, beer, mixer, garnish, supply, other. Unit examples: bottle, case, keg, can, each, liter. Prices should be cents when present. Return STRICT JSON matching schema: {"notes": "string", "items": [{"name": "string", "category": "spirit|wine|beer|mixer|garnish|supply|other", "area": "string", "unit": "string", "parLevel": number, "onHand": number, "unitCostCents": number, "supplier": "string", "sku": "string", "notes": "string"}]}`,
        },
      ];
      if (inputText) {
        promptContent.push({ type: 'text', text: inputText });
      }
      if (body.imageBase64) {
        promptContent.push({
          type: 'image_url',
          image_url: {
            url: `data:${imageMimeType};base64,${body.imageBase64}`,
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
      });
      const json: any = await response.json();
      if (!response.ok) {
        throw new BadRequestException(json?.error?.message ?? 'OpenRouter inventory parse failed');
      }
      const rawText = json?.choices?.[0]?.message?.content ?? '{"notes":"","items":[]}';
      parsed = parseAiInventoryJson(rawText);
    } else {
      const content: Array<Record<string, unknown>> = [
        {
          type: 'input_text',
          text: `Extract bar inventory items from this input. Return only bar stock items. Infer reasonable categories from: spirit, wine, beer, mixer, garnish, supply, other. Unit examples: bottle, case, keg, can, each, liter. Prices should be cents when present.\n\n${inputText}`,
        },
      ];
      if (body.imageBase64) {
        content.push({
          type: 'input_image',
          image_url: `data:${imageMimeType};base64,${body.imageBase64}`,
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
      });

      const json: any = await response.json();
      if (!response.ok) {
        throw new BadRequestException(json?.error?.message ?? 'OpenAI inventory parse failed');
      }
      const outputText =
        json.output_text ??
        json.output
          ?.flatMap((part: any) => part.content ?? [])
          .find((part: any) => part.type === 'output_text')?.text;
      parsed = parseAiInventoryJson(outputText ?? '{"notes":"No output","items":[]}');
    }
    const parsedItems = Array.isArray(parsed.items) ? parsed.items : [];
    return {
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      items: parsedItems.slice(0, MAX_IMPORT_ITEMS).map((item: any) => ({
        name: String(item.name ?? ''),
        category: CATEGORIES.includes(item.category) ? item.category : 'other',
        area: cleanText(item.area),
        unit: String(item.unit || 'unit'),
        parLevel: Number(item.parLevel || 0),
        onHand: Number(item.onHand || 0),
        unitCostCents: Number(item.unitCostCents || 0),
        supplier: cleanText(item.supplier),
        sku: cleanText(item.sku),
        notes: cleanText(item.notes),
      })),
    };
  }

  private async getProfile(user: AuthUser) {
    return this.prisma.profile.findFirst({ where: { userId: user.sub }, include: { venue: true } });
  }

  private async requireManagerProfile(user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile?.venueId) throw new ForbiddenException('Profile is not initialized');
    if (!isAdminRole(profile.role)) throw new ForbiddenException('Not authorized');
    return profile;
  }
}
