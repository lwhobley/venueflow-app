import { action, internalQuery, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireActiveSubscription } from './billing/shared';

type AnyCtx = any;

const categoryValue = v.union(v.literal('spirit'), v.literal('wine'), v.literal('beer'), v.literal('mixer'), v.literal('garnish'), v.literal('supply'), v.literal('other'));
const movementTypeValue = v.union(v.literal('count'), v.literal('received'), v.literal('waste'), v.literal('comp'), v.literal('transfer'), v.literal('correction'));

const parsedItemValue = v.object({
  name: v.string(),
  category: categoryValue,
  area: v.optional(v.string()),
  unit: v.string(),
  parLevel: v.optional(v.number()),
  onHand: v.optional(v.number()),
  unitCostCents: v.optional(v.number()),
  supplier: v.optional(v.string()),
  sku: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const MAX_IMPORT_ITEMS = 100;
const MAX_PARSE_TEXT_CHARS = 20_000;
const MAX_IMAGE_BASE64_CHARS = 6_000_000;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

async function getProfile(ctx: AnyCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db.query('profiles').withIndex('by_userId', (q: any) => q.eq('userId', userId)).unique();
}

function canManage(role: string) {
  return role === 'admin' || role === 'owner' || role === 'manager';
}

function cleanText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function mapItem(item: Doc<'barInventoryItems'>) {
  return {
    _id: item._id,
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
    lastCountedAt: item.lastCountedAt ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export const getBarStock = query({
  args: { venueId: v.id('venues') },
  returns: v.union(
    v.null(),
    v.object({
      items: v.array(
        v.object({
          _id: v.id('barInventoryItems'),
          venueId: v.id('venues'),
          name: v.string(),
          category: categoryValue,
          area: v.union(v.string(), v.null()),
          unit: v.string(),
          parLevel: v.number(),
          onHand: v.number(),
          unitCostCents: v.union(v.number(), v.null()),
          supplier: v.union(v.string(), v.null()),
          sku: v.union(v.string(), v.null()),
          notes: v.union(v.string(), v.null()),
          lastCountedAt: v.union(v.number(), v.null()),
          createdAt: v.number(),
          updatedAt: v.number(),
        }),
      ),
      lowStockCount: v.number(),
      totalValueCents: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    const items = await (ctx as AnyCtx).db.query('barInventoryItems').withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId)).take(300);
    return {
      items: items.map(mapItem).sort((a: ReturnType<typeof mapItem>, b: ReturnType<typeof mapItem>) => a.name.localeCompare(b.name)),
      lowStockCount: items.filter((item: Doc<'barInventoryItems'>) => item.onHand <= item.parLevel).length,
      totalValueCents: items.reduce((sum: number, item: Doc<'barInventoryItems'>) => sum + Math.round(item.onHand * (item.unitCostCents ?? 0)), 0),
    };
  },
});

export const upsertBarItem = mutation({
  args: {
    venueId: v.id('venues'),
    itemId: v.optional(v.id('barInventoryItems')),
    name: v.string(),
    category: categoryValue,
    area: v.optional(v.string()),
    unit: v.string(),
    parLevel: v.number(),
    onHand: v.number(),
    unitCostCents: v.optional(v.number()),
    supplier: v.optional(v.string()),
    sku: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.id('barInventoryItems'),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) throw new Error('Not authorized');
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    const now = Date.now();
    const payload = {
      venueId: args.venueId,
      name: args.name.trim(),
      category: args.category,
      area: cleanText(args.area),
      unit: args.unit.trim() || 'unit',
      parLevel: Math.max(0, args.parLevel),
      onHand: Math.max(0, args.onHand),
      unitCostCents: args.unitCostCents === undefined ? undefined : Math.max(0, Math.round(args.unitCostCents)),
      supplier: cleanText(args.supplier),
      sku: cleanText(args.sku),
      notes: cleanText(args.notes),
      updatedAt: now,
    };
    if (!payload.name) throw new Error('Item name is required');
    if (args.itemId) {
      const existing = await (ctx as AnyCtx).db.get(args.itemId);
      if (!existing || existing.venueId !== args.venueId) throw new Error('Item not found');
      await (ctx as AnyCtx).db.patch(existing._id, payload);
      return existing._id;
    }
    return await (ctx as AnyCtx).db.insert('barInventoryItems', { ...payload, createdAt: now, lastCountedAt: undefined });
  },
});

export const recordBarStockMovement = mutation({
  args: {
    venueId: v.id('venues'),
    itemId: v.id('barInventoryItems'),
    movementType: movementTypeValue,
    quantity: v.number(),
    notes: v.optional(v.string()),
  },
  returns: v.id('barInventoryMovements'),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) throw new Error('Not authorized');
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    const item = await (ctx as AnyCtx).db.get(args.itemId);
    if (!item || item.venueId !== args.venueId) throw new Error('Item not found');
    const previousOnHand = item.onHand;
    const nextOnHand = args.movementType === 'count' ? Math.max(0, args.quantity) : Math.max(0, previousOnHand + args.quantity);
    const now = Date.now();
    await (ctx as AnyCtx).db.patch(item._id, { onHand: nextOnHand, lastCountedAt: args.movementType === 'count' ? now : item.lastCountedAt, updatedAt: now });
    return await (ctx as AnyCtx).db.insert('barInventoryMovements', {
      venueId: args.venueId,
      itemId: item._id,
      movementType: args.movementType,
      quantity: args.quantity,
      previousOnHand,
      nextOnHand,
      notes: cleanText(args.notes),
      createdBy: profile._id,
      createdAt: now,
    });
  },
});

export const importParsedBarItems = mutation({
  args: { venueId: v.id('venues'), items: v.array(parsedItemValue) },
  returns: v.object({ imported: v.number() }),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) throw new Error('Not authorized');
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    let imported = 0;
    const existingRows = (await (ctx as AnyCtx).db.query('barInventoryItems').withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId)).take(500)) as Doc<'barInventoryItems'>[];
    const existingByName = new Map<string, Doc<'barInventoryItems'>>(existingRows.map((row) => [row.name.toLowerCase(), row]));
    const seenNames = new Set<string>();
    for (const item of args.items.slice(0, MAX_IMPORT_ITEMS)) {
      const name = item.name.trim();
      if (!name) continue;
      const nameKey = name.toLowerCase();
      if (seenNames.has(nameKey)) continue;
      seenNames.add(nameKey);
      const now = Date.now();
      const existing = existingByName.get(nameKey);
      const payload = {
        venueId: args.venueId,
        name,
        category: item.category,
        area: cleanText(item.area),
        unit: item.unit.trim() || 'unit',
        parLevel: Math.max(0, item.parLevel ?? 0),
        onHand: Math.max(0, item.onHand ?? 0),
        unitCostCents: item.unitCostCents === undefined ? undefined : Math.max(0, Math.round(item.unitCostCents)),
        supplier: cleanText(item.supplier),
        sku: cleanText(item.sku),
        notes: cleanText(item.notes),
        updatedAt: now,
      };
      if (existing) await (ctx as AnyCtx).db.patch(existing._id, payload);
      else await (ctx as AnyCtx).db.insert('barInventoryItems', { ...payload, createdAt: now, lastCountedAt: undefined });
      imported += 1;
    }
    return { imported };
  },
});

export const authorizeAiParse = internalQuery({
  args: { venueId: v.id('venues') },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return false;
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    return true;
  },
});

export const parseBarInventoryInput = action({
  args: {
    venueId: v.id('venues'),
    text: v.optional(v.string()),
    imageBase64: v.optional(v.string()),
    imageMimeType: v.optional(v.string()),
  },
  returns: v.object({ items: v.array(parsedItemValue), notes: v.string() }),
  handler: async (ctx, args): Promise<{ items: Array<any>; notes: string }> => {
    const authorized: boolean = await ctx.runQuery(internal.barInventory.authorizeAiParse, { venueId: args.venueId });
    if (!authorized) throw new Error('Not authorized');
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
    const inputText = args.text?.trim() ?? '';
    if (!inputText && !args.imageBase64) throw new Error('Add pasted text, a CSV/list upload, or a photo to parse');
    if (inputText.length > MAX_PARSE_TEXT_CHARS) throw new Error(`Text imports are limited to ${MAX_PARSE_TEXT_CHARS.toLocaleString()} characters`);
    if (args.imageBase64 && args.imageBase64.length > MAX_IMAGE_BASE64_CHARS) throw new Error('Photo imports are limited to about 4.5MB');
    const imageMimeType = args.imageMimeType ?? 'image/jpeg';
    if (args.imageBase64 && !ALLOWED_IMAGE_MIME_TYPES.has(imageMimeType)) throw new Error('Photo imports must be JPEG, PNG, WebP, HEIC, or HEIF');

    const content: Array<Record<string, unknown>> = [
      {
        type: 'input_text',
        text: `Extract bar inventory items from this input. Return only bar stock items. Infer reasonable categories from: spirit, wine, beer, mixer, garnish, supply, other. Unit examples: bottle, case, keg, can, each, liter. Prices should be cents when present.\n\n${inputText}`,
      },
    ];
    if (args.imageBase64) {
      content.push({
        type: 'input_image',
        image_url: `data:${imageMimeType};base64,${args.imageBase64}`,
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
                      category: { type: 'string', enum: ['spirit', 'wine', 'beer', 'mixer', 'garnish', 'supply', 'other'] },
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
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error?.message ?? 'OpenAI inventory parse failed');
    const outputText = json.output_text ?? json.output?.flatMap((part: any) => part.content ?? []).find((part: any) => part.type === 'output_text')?.text;
    const parsed = JSON.parse(outputText ?? '{"notes":"No output","items":[]}');
    return {
      notes: parsed.notes ?? '',
      items: (parsed.items ?? []).slice(0, 100).map((item: any) => ({
        name: String(item.name ?? ''),
        category: item.category,
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
  },
});
