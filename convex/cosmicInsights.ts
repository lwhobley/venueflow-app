import { internalAction, internalMutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';

const insightValue = v.object({ kind: v.string(), title: v.string(), body: v.string() });

// Public: latest AI-generated batch (most recent 3). Empty => UI uses its
// curated fallback library.
export const getLatestInsights = query({
  args: {},
  returns: v.array(insightValue),
  handler: async (ctx) => {
    const rows = await ctx.db.query('cosmicInsights').withIndex('by_batchAt').order('desc').take(3);
    return rows.map((r) => ({ kind: r.kind, title: r.title, body: r.body }));
  },
});

// Internal: replace the stored batch with a fresh one.
export const replaceInsights = internalMutation({
  args: { items: v.array(insightValue) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('cosmicInsights').collect();
    for (const row of existing) await ctx.db.delete(row._id);
    const batchAt = Date.now();
    for (const it of args.items) {
      await ctx.db.insert('cosmicInsights', { kind: it.kind, title: it.title, body: it.body, batchAt });
    }
    return null;
  },
});

const SYSTEM_PROMPT =
  'You write punchy insights for a restaurant/bar staff dashboard. Return STRICT JSON only: an array of exactly 3 objects with keys "kind", "title", "body". ' +
  'Item 1 kind="Trade Tip" — a genuinely useful tip of the trade for servers or bartenders (e.g. the 10 steps of service, fine-dining service style, fork/glassware etiquette, wine service, shaking vs stirring). ' +
  'Item 2 kind="F&B Fact" — a true, interesting food & beverage fact. ' +
  'Item 3 kind="Joke" — a clean, funny hospitality joke. ' +
  'Keep each title under 6 words and each body under 320 characters. No markdown, no preamble — JSON only.';

// Internal-ish action (also runnable from cron): generate a fresh batch via
// OpenRouter and store it. No-op if OPENROUTER_API_KEY isn't configured.
export const generateInsights = internalAction({
  args: {},
  returns: v.object({ generated: v.number() }),
  handler: async (ctx): Promise<{ generated: number }> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.warn('[cosmicInsights] OPENROUTER_API_KEY not set — skipping AI generation.');
      return { generated: 0 };
    }
    const model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://venue-wrangler.pages.dev',
          'X-Title': 'Venue Wrangler',
        },
        body: JSON.stringify({
          model,
          temperature: 0.9,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: 'Generate a fresh set of 3 insights now.' },
          ],
        }),
      });
      if (!res.ok) {
        console.error('[cosmicInsights] OpenRouter failed:', res.status, await res.text());
        return { generated: 0 };
      }
      const json: any = await res.json();
      const content: string = json?.choices?.[0]?.message?.content ?? '';
      const jsonText = content.slice(content.indexOf('['), content.lastIndexOf(']') + 1);
      const parsed = JSON.parse(jsonText) as Array<{ kind?: string; title?: string; body?: string }>;
      const items = parsed
        .filter((p) => p && p.title && p.body)
        .slice(0, 3)
        .map((p) => ({ kind: String(p.kind ?? 'Insight'), title: String(p.title), body: String(p.body) }));
      if (items.length === 0) return { generated: 0 };
      await ctx.runMutation(internal.cosmicInsights.replaceInsights, { items });
      return { generated: items.length };
    } catch (e) {
      console.error('[cosmicInsights] generation error:', e);
      return { generated: 0 };
    }
  },
});
