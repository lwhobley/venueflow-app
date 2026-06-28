import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { csvCell } from '../../common/csv';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { EmailService } from '../../email/email.service';

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

class UpdateCostDto {
  @IsNumber()
  @Min(0)
  unitCostCents!: number;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

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
    const { movement, item, previousOnHand, nextOnHand } = await this.prisma.$transaction(async (tx) => {
      const lockKey = `bar-inventory-${itemId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
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
      const movement = await tx.barInventoryMovement.create({
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
      return { movement, item, previousOnHand, nextOnHand };
    });

    // Fire-and-forget alerts after the transaction commits
    void this.fireInventoryAlerts({ venueId, item, previousOnHand, nextOnHand, movementType: body.movementType, quantity: body.quantity });

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

  // ── Usage velocity ───────────────────────────────────────────────────
  @RequireSubscription('active')
  @Get('velocity')
  async getUsageVelocity(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
    const items = await this.prisma.barInventoryItem.findMany({
      where: { venueId },
      take: 300,
    });
    const depletions = await this.prisma.barInventoryMovement.findMany({
      where: {
        venueId,
        createdAt: { gte: fourWeeksAgo },
        movementType: { in: ['waste', 'comp', 'transfer'] },
      },
      select: { itemId: true, quantity: true, createdAt: true },
    });
    const countMovements = await this.prisma.barInventoryMovement.findMany({
      where: {
        venueId,
        createdAt: { gte: fourWeeksAgo },
        movementType: 'count',
      },
      select: { itemId: true, quantity: true, previousOnHand: true, createdAt: true },
    });
    const usageByItem = new Map<string, number>();
    for (const d of depletions) {
      usageByItem.set(d.itemId, (usageByItem.get(d.itemId) ?? 0) + Math.abs(d.quantity));
    }
    for (const c of countMovements) {
      const impliedUsage = c.previousOnHand - c.quantity;
      if (impliedUsage > 0) {
        usageByItem.set(c.itemId, (usageByItem.get(c.itemId) ?? 0) + impliedUsage);
      }
    }
    const weeks = 4;
    return items.map((item) => {
      const totalUsed = usageByItem.get(item.id) ?? 0;
      const perWeek = totalUsed / weeks;
      const daysUntilEmpty = perWeek > 0 ? Math.round((item.onHand / (perWeek / 7)) * 10) / 10 : null;
      return {
        _id: item.id,
        name: item.name,
        category: item.category,
        onHand: item.onHand,
        parLevel: item.parLevel,
        unit: item.unit,
        usageLast4Weeks: Math.round(totalUsed * 10) / 10,
        perWeek: Math.round(perWeek * 10) / 10,
        daysUntilEmpty,
      };
    });
  }

  // ── Stock CSV export ─────────────────────────────────────────────────
  @RequireSubscription('active')
  @Get('export-csv')
  async exportStockCsv(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const items = await this.prisma.barInventoryItem.findMany({
      where: { venueId },
      orderBy: { name: 'asc' },
      take: 500,
    });
    const headers = ['Name', 'Category', 'Area', 'Unit', 'On Hand', 'Par Level', 'Unit Cost ($)', 'Supplier', 'SKU', 'Last Counted'];
    const rows = [headers.map(csvCell).join(',')];
    for (const item of items) {
      rows.push([
        csvCell(item.name),
        csvCell(item.category),
        csvCell(item.area),
        csvCell(item.unit),
        csvCell(item.onHand),
        csvCell(item.parLevel),
        csvCell(item.unitCostCents != null ? (item.unitCostCents / 100).toFixed(2) : ''),
        csvCell(item.supplier),
        csvCell(item.sku),
        csvCell(item.lastCountedAt ? item.lastCountedAt.toISOString().slice(0, 10) : ''),
      ].join(','));
    }
    return rows.join('\n');
  }

  // ── Movement log CSV export ──────────────────────────────────────────
  @RequireSubscription('active')
  @Get('movements/export-csv')
  async exportMovementsCsv(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const movements = await this.prisma.barInventoryMovement.findMany({
      where: { venueId, createdAt: { gte: twoWeeksAgo } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const itemIds = Array.from(new Set(movements.map((m) => m.itemId)));
    const profileIds = Array.from(new Set(movements.map((m) => m.createdBy).filter(Boolean)));
    const [items, profiles] = await Promise.all([
      itemIds.length ? this.prisma.barInventoryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } }) : [],
      profileIds.length ? this.prisma.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, fullName: true } }) : [],
    ]);
    const itemName = new Map(items.map((i) => [i.id, i.name]));
    const profileName = new Map(profiles.map((p) => [p.id, p.fullName]));
    const headers = ['Date', 'Item', 'Type', 'Quantity', 'Before', 'After', 'By', 'Notes'];
    const rows = [headers.map(csvCell).join(',')];
    for (const m of movements) {
      rows.push([
        csvCell(m.createdAt.toISOString().slice(0, 19).replace('T', ' ')),
        csvCell(itemName.get(m.itemId) ?? m.itemId),
        csvCell(m.movementType),
        csvCell(m.quantity),
        csvCell(m.previousOnHand),
        csvCell(m.nextOnHand),
        csvCell(profileName.get(m.createdBy) ?? m.createdBy),
        csvCell(m.notes),
      ].join(','));
    }
    return rows.join('\n');
  }

  // ── Shrinkage / variance report ──────────────────────────────────────
  @RequireSubscription('active')
  @Get('shrinkage')
  async getShrinkageReport(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [movements, items] = await Promise.all([
      this.prisma.barInventoryMovement.findMany({
        where: { venueId, createdAt: { gte: thirtyDaysAgo } },
        select: { itemId: true, movementType: true, quantity: true, createdAt: true },
      }),
      this.prisma.barInventoryItem.findMany({
        where: { venueId },
        select: { id: true, category: true, name: true, unitCostCents: true },
      }),
    ]);
    const itemMap = new Map(items.map((i) => [i.id, i]));

    // Aggregate by category
    const byCategory = new Map<string, { received: number; waste: number; comp: number; wasteCents: number; compCents: number }>();
    const initCat = () => ({ received: 0, waste: 0, comp: 0, wasteCents: 0, compCents: 0 });

    for (const m of movements) {
      const item = itemMap.get(m.itemId);
      if (!item) continue;
      const cat = item.category;
      const entry = byCategory.get(cat) ?? initCat();
      const costCents = item.unitCostCents ?? 0;
      if (m.movementType === 'received') {
        entry.received += Math.abs(m.quantity);
      } else if (m.movementType === 'waste') {
        entry.waste += Math.abs(m.quantity);
        entry.wasteCents += Math.abs(m.quantity) * costCents;
      } else if (m.movementType === 'comp') {
        entry.comp += Math.abs(m.quantity);
        entry.compCents += Math.abs(m.quantity) * costCents;
      }
      byCategory.set(cat, entry);
    }

    const rows = Array.from(byCategory.entries()).map(([category, data]) => {
      const totalShrinkage = data.waste + data.comp;
      const shrinkagePct = data.received > 0 ? Math.round((totalShrinkage / data.received) * 1000) / 10 : null;
      return {
        category,
        receivedUnits: Math.round(data.received * 10) / 10,
        wasteUnits: Math.round(data.waste * 10) / 10,
        compUnits: Math.round(data.comp * 10) / 10,
        totalShrinkageUnits: Math.round(totalShrinkage * 10) / 10,
        shrinkagePct,
        wasteCents: Math.round(data.wasteCents),
        compCents: Math.round(data.compCents),
        totalShrinkageCents: Math.round(data.wasteCents + data.compCents),
      };
    }).sort((a, b) => (b.totalShrinkageCents) - (a.totalShrinkageCents));

    const totals = rows.reduce((acc, r) => ({
      receivedUnits: acc.receivedUnits + r.receivedUnits,
      totalShrinkageUnits: acc.totalShrinkageUnits + r.totalShrinkageUnits,
      totalShrinkageCents: acc.totalShrinkageCents + r.totalShrinkageCents,
    }), { receivedUnits: 0, totalShrinkageUnits: 0, totalShrinkageCents: 0 });

    return { rows, totals, windowDays: 30 };
  }

  // ── Purchase order draft ─────────────────────────────────────────────
  @RequireSubscription('active')
  @Get('purchase-order')
  async getPurchaseOrder(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const items = await this.prisma.barInventoryItem.findMany({
      where: { venueId },
      orderBy: [{ supplier: 'asc' }, { name: 'asc' }],
      take: 500,
    });
    const belowPar = items.filter((i) => i.onHand < i.parLevel);

    const bySupplier = new Map<string, typeof belowPar>();
    for (const item of belowPar) {
      const supplier = item.supplier?.trim() || 'Unspecified';
      const group = bySupplier.get(supplier) ?? [];
      group.push(item);
      bySupplier.set(supplier, group);
    }

    const groups = Array.from(bySupplier.entries()).map(([supplier, groupItems]) => {
      const lines = groupItems.map((item) => {
        const qtyToOrder = Math.ceil(item.parLevel - item.onHand);
        return {
          _id: item.id,
          name: item.name,
          sku: item.sku,
          unit: item.unit,
          onHand: item.onHand,
          parLevel: item.parLevel,
          qtyToOrder,
          unitCostCents: item.unitCostCents,
          lineTotalCents: item.unitCostCents != null ? Math.round(qtyToOrder * item.unitCostCents) : null,
        };
      });
      const groupTotalCents = lines.reduce((sum, l) => sum + (l.lineTotalCents ?? 0), 0);
      return { supplier, lines, groupTotalCents };
    });

    const grandTotalCents = groups.reduce((sum, g) => sum + g.groupTotalCents, 0);
    return { groups, grandTotalCents, itemCount: belowPar.length };
  }

  // ── Purchase order CSV ───────────────────────────────────────────────
  @RequireSubscription('active')
  @Get('purchase-order/export-csv')
  async exportPurchaseOrderCsv(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const items = await this.prisma.barInventoryItem.findMany({
      where: { venueId },
      orderBy: [{ supplier: 'asc' }, { name: 'asc' }],
      take: 200,
    });
    const belowPar = items.filter((i) => i.onHand < i.parLevel);
    const headers = ['Supplier', 'Item', 'SKU', 'Unit', 'On Hand', 'Par', 'Order Qty', 'Unit Cost ($)', 'Line Total ($)'];
    const rows = [headers.map(csvCell).join(',')];
    for (const item of belowPar) {
      const qty = Math.ceil(item.parLevel - item.onHand);
      const unitCost = item.unitCostCents != null ? (item.unitCostCents / 100).toFixed(2) : '';
      const lineTotal = item.unitCostCents != null ? (qty * item.unitCostCents / 100).toFixed(2) : '';
      rows.push([
        csvCell(item.supplier ?? 'Unspecified'),
        csvCell(item.name),
        csvCell(item.sku),
        csvCell(item.unit),
        csvCell(item.onHand),
        csvCell(item.parLevel),
        csvCell(qty),
        csvCell(unitCost),
        csvCell(lineTotal),
      ].join(','));
    }
    return rows.join('\n');
  }

  // ── SKU lookup for barcode scanning ──────────────────────────────────
  @RequireSubscription('active')
  @Get('sku/:sku')
  async lookupBySku(@CurrentUser() user: AuthUser, @Param('sku') sku: string) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const item = await this.prisma.barInventoryItem.findFirst({
      where: { venueId, sku },
    });
    if (!item) throw new NotFoundException('No item found with that SKU');
    return mapItem(item);
  }

  // ── Update unit cost (tracks history via correction movement) ─────────
  @RequireSubscription('active')
  @Patch(':id/cost')
  async updateItemCost(
    @CurrentUser() user: AuthUser,
    @Param('id') itemId: string,
    @Body() body: UpdateCostDto,
  ) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const item = await this.prisma.barInventoryItem.findFirst({ where: { id: itemId, venueId } });
    if (!item) throw new NotFoundException('Item not found');
    const oldCost = item.unitCostCents ?? 0;
    const newCost = Math.max(0, Math.round(body.unitCostCents));
    if (oldCost === newCost) return mapItem(item);
    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.barInventoryItem.update({
        where: { id: item.id },
        data: { unitCostCents: newCost, updatedAt: now },
      }),
      // Write a zero-quantity correction so cost history is queryable from movement log
      this.prisma.barInventoryMovement.create({
        data: {
          venueId,
          itemId: item.id,
          movementType: 'correction',
          quantity: 0,
          previousOnHand: item.onHand,
          nextOnHand: item.onHand,
          notes: `cost_change:${oldCost}:${newCost}`,
          createdBy: profile.id,
          createdAt: now,
        },
      }),
    ]);
    return mapItem(updated);
  }

  // ── Cost history (from correction movements) ──────────────────────────
  @RequireSubscription('active')
  @Get('cost-history/:id')
  async getCostHistory(@CurrentUser() user: AuthUser, @Param('id') itemId: string) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const item = await this.prisma.barInventoryItem.findFirst({ where: { id: itemId, venueId } });
    if (!item) throw new NotFoundException('Item not found');
    const movements = await this.prisma.barInventoryMovement.findMany({
      where: { itemId, venueId, movementType: 'correction', notes: { startsWith: 'cost_change:' } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const profileIds = Array.from(new Set(movements.map((m) => m.createdBy).filter(Boolean)));
    const profiles = profileIds.length
      ? await this.prisma.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, fullName: true } })
      : [];
    const nameById = new Map(profiles.map((p) => [p.id, p.fullName]));
    const entries = movements.map((m) => {
      const parts = (m.notes ?? '').split(':');
      const oldCost = Number(parts[1] ?? 0);
      const newCost = Number(parts[2] ?? 0);
      return {
        _id: m.id,
        oldCostCents: oldCost,
        newCostCents: newCost,
        changedBy: nameById.get(m.createdBy) ?? m.createdBy,
        createdAt: m.createdAt.getTime(),
      };
    });
    return { itemName: item.name, currentCostCents: item.unitCostCents, entries };
  }

  // ── Stock aging report ───────────────────────────────────────────────
  @RequireSubscription('active')
  @Get('aging')
  async getAgingReport(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [items, recentMovements] = await Promise.all([
      this.prisma.barInventoryItem.findMany({ where: { venueId }, take: 500 }),
      this.prisma.barInventoryMovement.findMany({
        where: { venueId, createdAt: { gte: thirtyDaysAgo } },
        select: { itemId: true, movementType: true, createdAt: true },
      }),
    ]);

    // Build last-movement-date index per item
    const lastMovedAt = new Map<string, Date>();
    const lastReceivedAt = new Map<string, Date>();
    for (const m of recentMovements) {
      const prev = lastMovedAt.get(m.itemId);
      if (!prev || m.createdAt > prev) lastMovedAt.set(m.itemId, m.createdAt);
      if (m.movementType === 'received') {
        const prevR = lastReceivedAt.get(m.itemId);
        if (!prevR || m.createdAt > prevR) lastReceivedAt.set(m.itemId, m.createdAt);
      }
    }

    const uncounted = items.filter((i) => !i.lastCountedAt || i.lastCountedAt < sevenDaysAgo);
    const noActivity = items.filter((i) => {
      const last = lastMovedAt.get(i.id);
      return !last; // no movement in 30 days
    });
    const staleCost = items.filter((i) => i.unitCostCents == null && i.onHand > 0);

    return {
      uncountedItems: uncounted.map((i) => ({
        _id: i.id,
        name: i.name,
        category: i.category,
        lastCountedAt: i.lastCountedAt?.getTime() ?? null,
        daysSinceCount: i.lastCountedAt ? Math.floor((Date.now() - i.lastCountedAt.getTime()) / 86400000) : null,
      })),
      noActivityItems: noActivity.map((i) => ({ _id: i.id, name: i.name, category: i.category, onHand: i.onHand })),
      staleCostItems: staleCost.map((i) => ({ _id: i.id, name: i.name, category: i.category, onHand: i.onHand })),
    };
  }

  // ── Send purchase order email ─────────────────────────────────────────
  @RequireSubscription('active')
  @Post('purchase-order/send-email')
  async sendPurchaseOrderEmail(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const items = await this.prisma.barInventoryItem.findMany({ where: { venueId }, orderBy: [{ supplier: 'asc' }, { name: 'asc' }], take: 500 });
    const belowPar = items.filter((i) => i.onHand < i.parLevel);
    if (belowPar.length === 0) return { sent: false, reason: 'All items at or above par — nothing to order.' };

    const bySupplier = new Map<string, typeof belowPar>();
    for (const item of belowPar) {
      const supplier = item.supplier?.trim() || 'Unspecified';
      const group = bySupplier.get(supplier) ?? [];
      group.push(item);
      bySupplier.set(supplier, group);
    }

    let grandTotal = 0;
    const supplierSections = Array.from(bySupplier.entries()).map(([supplier, groupItems]) => {
      const rows = groupItems.map((item) => {
        const qty = Math.ceil(item.parLevel - item.onHand);
        const lineTotal = item.unitCostCents != null ? qty * item.unitCostCents : null;
        if (lineTotal != null) grandTotal += lineTotal;
        return `<tr><td>${item.name}</td><td>${item.sku ?? '—'}</td><td>${item.unit}</td><td>${item.onHand}</td><td>${item.parLevel}</td><td><strong>${qty}</strong></td><td>${lineTotal != null ? '$' + (lineTotal / 100).toFixed(2) : '—'}</td></tr>`;
      }).join('');
      return `<h3>${supplier}</h3><table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><tr><th>Item</th><th>SKU</th><th>Unit</th><th>On Hand</th><th>Par</th><th>Order Qty</th><th>Est. Cost</th></tr>${rows}</table>`;
    }).join('<br>');

    const venueName = profile.venue?.name ?? 'Your venue';
    const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const html = `<h2>Purchase Order — ${venueName}</h2><p>Generated ${date} · ${belowPar.length} items below par</p>${supplierSections}${grandTotal > 0 ? `<p><strong>Estimated total: $${(grandTotal / 100).toFixed(2)}</strong></p>` : ''}`;
    const text = `Purchase Order — ${venueName}\n${date} · ${belowPar.length} items below par\n\n${belowPar.map((i) => `${i.supplier ?? 'Unspecified'}: ${i.name} — order ${Math.ceil(i.parLevel - i.onHand)} ${i.unit}`).join('\n')}${grandTotal > 0 ? `\n\nEst. total: $${(grandTotal / 100).toFixed(2)}` : ''}`;

    await this.email.sendToVenueManagers(venueId, {
      subject: `Purchase Order — ${venueName} (${belowPar.length} items)`,
      text,
      html,
    });
    return { sent: true, itemCount: belowPar.length };
  }

  // ── Inventory digest email ────────────────────────────────────────────
  @RequireSubscription('active')
  @Post('send-digest')
  async sendInventoryDigest(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [items, movements] = await Promise.all([
      this.prisma.barInventoryItem.findMany({ where: { venueId }, take: 500 }),
      this.prisma.barInventoryMovement.findMany({
        where: { venueId, createdAt: { gte: thirtyDaysAgo } },
        select: { itemId: true, movementType: true, quantity: true },
      }),
    ]);

    const itemMap = new Map(items.map((i) => [i.id, i]));
    const belowPar = items.filter((i) => i.onHand < i.parLevel);
    const uncounted = items.filter((i) => !i.lastCountedAt || i.lastCountedAt < sevenDaysAgo);

    let wasteCents = 0;
    let compCents = 0;
    for (const m of movements) {
      const item = itemMap.get(m.itemId);
      if (!item) continue;
      const cost = item.unitCostCents ?? 0;
      if (m.movementType === 'waste') wasteCents += Math.abs(m.quantity) * cost;
      if (m.movementType === 'comp') compCents += Math.abs(m.quantity) * cost;
    }

    const venueName = profile.venue?.name ?? 'Your venue';
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const belowParLines = belowPar.slice(0, 20).map((i) => `  • ${i.name}: ${i.onHand} ${i.unit} on hand (par ${i.parLevel})`).join('\n');
    const text = [
      `📊 Inventory Digest — ${venueName}`,
      date,
      '',
      `Below par: ${belowPar.length} item${belowPar.length !== 1 ? 's' : ''}`,
      belowParLines || '  (none)',
      '',
      `30-day shrinkage: waste $${(wasteCents / 100).toFixed(2)} · comp $${(compCents / 100).toFixed(2)} · total $${((wasteCents + compCents) / 100).toFixed(2)}`,
      '',
      `Items not counted in 7+ days: ${uncounted.length}`,
      `Total items tracked: ${items.length}`,
    ].join('\n');

    const html = `
      <h2>Inventory Digest — ${venueName}</h2>
      <p>${date}</p>
      <h3>Below par (${belowPar.length} items)</h3>
      ${belowPar.length === 0 ? '<p>All items at or above par.</p>' : `<ul>${belowPar.slice(0, 20).map((i) => `<li>${i.name}: ${i.onHand} ${i.unit} (par ${i.parLevel})</li>`).join('')}${belowPar.length > 20 ? `<li>…and ${belowPar.length - 20} more</li>` : ''}</ul>`}
      <h3>30-day shrinkage</h3>
      <p>Waste: <strong>$${(wasteCents / 100).toFixed(2)}</strong> · Comp: <strong>$${(compCents / 100).toFixed(2)}</strong> · Total: <strong>$${((wasteCents + compCents) / 100).toFixed(2)}</strong></p>
      <h3>Inventory health</h3>
      <p>Items not counted in 7+ days: <strong>${uncounted.length}</strong> · Total items tracked: <strong>${items.length}</strong></p>
    `;

    await this.email.sendToVenueManagers(venueId, {
      subject: `Inventory Digest — ${venueName} · ${belowPar.length} below par`,
      text,
      html,
    });

    void this.notifications.notifyManagers({
      venueId,
      kind: 'inventory_digest',
      title: 'Inventory digest sent',
      body: `${belowPar.length} items below par · $${((wasteCents + compCents) / 100).toFixed(2)} shrinkage (30d)`,
    });

    return { sent: true, belowParCount: belowPar.length, shrinkageCents: wasteCents + compCents };
  }

  // ── Movement history (parameterized — must come after literal routes) ─
  @RequireSubscription('active')
  @Get(':id/movements')
  async getItemMovements(
    @CurrentUser() user: AuthUser,
    @Param('id') itemId: string,
    @Query('limit') limitParam?: string,
  ) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const item = await this.prisma.barInventoryItem.findFirst({ where: { id: itemId, venueId } });
    if (!item) throw new NotFoundException('Item not found');
    const limit = Math.min(Math.max(1, Number(limitParam) || 50), 200);
    const movements = await this.prisma.barInventoryMovement.findMany({
      where: { itemId, venueId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const profileIds = Array.from(new Set(movements.map((m) => m.createdBy).filter(Boolean)));
    const profiles = profileIds.length
      ? await this.prisma.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, fullName: true } })
      : [];
    const nameById = new Map(profiles.map((p) => [p.id, p.fullName]));
    return {
      itemName: item.name,
      movements: movements.map((m) => ({
        _id: m.id,
        movementType: m.movementType,
        quantity: m.quantity,
        previousOnHand: m.previousOnHand,
        nextOnHand: m.nextOnHand,
        notes: m.notes,
        createdBy: nameById.get(m.createdBy) ?? m.createdBy,
        createdAt: m.createdAt.getTime(),
      })),
    };
  }

  private async fireInventoryAlerts(args: {
    venueId: string;
    item: { id: string; name: string; parLevel: number; unitCostCents: number | null };
    previousOnHand: number;
    nextOnHand: number;
    movementType: string;
    quantity: number;
  }) {
    const { venueId, item, previousOnHand, nextOnHand, movementType, quantity } = args;

    // Low-stock alert: just crossed below par
    if (previousOnHand >= item.parLevel && nextOnHand < item.parLevel) {
      void this.notifications.notifyManagers({
        venueId,
        kind: 'inventory_low_stock',
        title: `Low stock: ${item.name}`,
        body: `${nextOnHand} ${nextOnHand === 1 ? 'unit' : 'units'} remaining (par ${item.parLevel})`,
      });
    }

    // Large waste/comp alert: loss > $50 in cost
    if ((movementType === 'waste' || movementType === 'comp') && item.unitCostCents != null) {
      const lossCents = Math.abs(quantity) * item.unitCostCents;
      if (lossCents >= 5000) {
        void this.notifications.notifyManagers({
          venueId,
          kind: 'inventory_large_loss',
          title: `Large ${movementType} recorded`,
          body: `${Math.abs(quantity)} × ${item.name} — est. $${(lossCents / 100).toFixed(2)} loss`,
        });
      }
    }
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
