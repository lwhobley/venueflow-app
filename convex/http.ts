import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { auth } from './auth';

const http = httpRouter();

// Registers the Convex Auth HTTP routes (used by the auth flows).
auth.addHttpRoutes(http);

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

async function verifyStripeSignature(payload: string, signatureHeader: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const timestamp = signatureHeader.split(',').find((part) => part.startsWith('t='))?.slice(2);
  const signatures = signatureHeader
    .split(',')
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) return false;
  // Reject payloads older than 5 minutes to prevent replay attacks.
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return signatures.some((signature) => timingSafeEqual(signature, digest));
}

http.route({
  path: '/stripe/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const payload = await req.text();
    const verified = await verifyStripeSignature(payload, req.headers.get('stripe-signature'));
    if (!verified) return new Response('Invalid signature', { status: 400 });
    let event: any;
    try {
      event = JSON.parse(payload);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }
    await ctx.runMutation(internal.billing.handleStripeWebhook, { event });
    return new Response('ok', { status: 200 });
  }),
});

function secretOk(expected: string | undefined, received: string | null) {
  return !!expected && !!received && timingSafeEqual(received, expected);
}

function receivedSecret(req: Request, headerName: string) {
  const raw = req.headers.get(headerName) ?? req.headers.get('authorization');
  return raw?.startsWith('Bearer ') ? raw.slice('Bearer '.length) : raw;
}

const LEAD_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-venueflow-leads-secret',
};

function leadJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...LEAD_CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function cleanString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function emailFromText(value: string | undefined) {
  return value?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

function phoneFromText(value: string | undefined) {
  return value?.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0];
}

function splitLeadTags(value: unknown) {
  if (Array.isArray(value)) return value.map((tag) => cleanString(tag)).filter((tag): tag is string => Boolean(tag)).slice(0, 12);
  return cleanString(value)
    ?.split(/[|,]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normaliseLead(value: any, defaultSource?: string) {
  if (!value || typeof value !== 'object') return null;
  const fullName = cleanString(value.fullName) ?? cleanString(value.name) ?? cleanString(value.guestName) ?? cleanString(value.customerName);
  if (!fullName) return null;
  const email = cleanString(value.email) ?? emailFromText(cleanString(value.contact));
  const phone = cleanString(value.phone) ?? cleanString(value.mobile) ?? phoneFromText(cleanString(value.contact));
  const lead = {
    fullName,
    phone,
    email,
    source: cleanString(value.source) ?? defaultSource,
    company: cleanString(value.company) ?? cleanString(value.organization),
    tags: splitLeadTags(value.tags),
    notes: cleanString(value.notes) ?? cleanString(value.message) ?? cleanString(value.description),
    marketingOptIn: typeof value.marketingOptIn === 'boolean' ? value.marketingOptIn : Boolean(value.optIn ?? value.marketing_opt_in ?? false),
  };
  return Object.fromEntries(Object.entries(lead).filter(([, leadValue]) => leadValue !== undefined)) as typeof lead;
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsvLeads(value: string, defaultSource?: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => !(index === 0 && /name/i.test(splitCsvLine(line)[0] ?? '')))
    .map((line) => {
      const [fullName, email, phone, source, company, tags, notes] = splitCsvLine(line);
      return normaliseLead({ fullName, email, phone, source, company, tags, notes, marketingOptIn: true }, defaultSource);
    })
    .filter((lead): lead is NonNullable<ReturnType<typeof normaliseLead>> => Boolean(lead));
}

function parseEmailLead(value: any, defaultSource?: string) {
  if (!value || typeof value !== 'object') return null;
  const text = [cleanString(value.subject), cleanString(value.text), cleanString(value.html)].filter(Boolean).join('\n');
  const from = cleanString(value.from);
  const fromName = from?.replace(/<.*?>/, '').trim();
  const explicitName = text.match(/^name:\s*(.+)$/im)?.[1]?.trim();
  const fullName = cleanString(value.name) ?? explicitName ?? fromName;
  return normaliseLead(
    {
      fullName,
      email: cleanString(value.email) ?? emailFromText(from) ?? emailFromText(text),
      phone: cleanString(value.phone) ?? phoneFromText(text),
      source: cleanString(value.source) ?? defaultSource ?? 'Email',
      company: cleanString(value.company),
      tags: value.tags,
      notes: text.slice(0, 2000),
      marketingOptIn: value.marketingOptIn,
    },
    defaultSource ?? 'Email',
  );
}

function leadsFromBody(body: any) {
  const defaultSource = cleanString(body?.source);
  const leads: Array<ReturnType<typeof normaliseLead>> = Array.isArray(body?.leads)
    ? body.leads.map((lead: any) => normaliseLead(lead, defaultSource))
    : body?.lead
      ? [normaliseLead(body.lead, defaultSource)]
      : [];
  if (cleanString(body?.csv) || cleanString(body?.csvText)) leads.push(...parseCsvLeads(cleanString(body.csv) ?? cleanString(body.csvText) ?? '', defaultSource));
  if (body?.email) leads.push(parseEmailLead(body.email, defaultSource));
  if (leads.length === 0) leads.push(normaliseLead(body, defaultSource));
  return leads.filter((lead): lead is NonNullable<ReturnType<typeof normaliseLead>> => Boolean(lead)).slice(0, 100);
}

http.route({
  path: '/crm/leads',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: LEAD_CORS_HEADERS })),
});

http.route({
  path: '/crm/leads',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    if (!secretOk(process.env.LEADS_WEBHOOK_SECRET, receivedSecret(req, 'x-venueflow-leads-secret'))) {
      return leadJson({ error: 'Unauthorized' }, 401);
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return leadJson({ error: 'Invalid JSON' }, 400);
    }
    if (!body?.venueId || typeof body.venueId !== 'string') return leadJson({ error: 'venueId is required' }, 400);
    const leads = leadsFromBody(body);
    if (leads.length === 0) return leadJson({ error: 'No valid leads found' }, 400);
    try {
      const result = await ctx.runMutation(internal.guests.ingestLeadsFromWebhook, { venueId: body.venueId, leads });
      return leadJson({ ok: true, ...result });
    } catch (e) {
      return leadJson({ error: e instanceof Error ? e.message : 'Lead ingest rejected' }, 400);
    }
  }),
});

http.route({
  path: '/pos/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    if (!secretOk(process.env.POS_WEBHOOK_SECRET, req.headers.get('x-venueflow-pos-secret'))) {
      return new Response('Unauthorized', { status: 401 });
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }
    // Per-connection secret, carried in a header alongside the transport secret.
    const connectionSecret = req.headers.get('x-venueflow-connection-secret');
    if (!body?.venueId || !body?.provider || !body?.check || !connectionSecret) return new Response('Bad request', { status: 400 });
    try {
      await ctx.runMutation(internal.pos.ingestPosCheck, {
        venueId: body.venueId,
        provider: body.provider,
        check: body.check,
        connectionSecret,
        externalLocationId: typeof body.externalLocationId === 'string' ? body.externalLocationId : undefined,
      });
    } catch (e) {
      return new Response('Rejected', { status: 400 });
    }
    return new Response('ok', { status: 200 });
  }),
});

// Labor punches (Toast employee shift data) — sent separately from check data.
http.route({
  path: '/pos/labor',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    if (!secretOk(process.env.POS_WEBHOOK_SECRET, req.headers.get('x-venueflow-pos-secret'))) {
      return new Response('Unauthorized', { status: 401 });
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }
    const connectionSecret = req.headers.get('x-venueflow-connection-secret');
    if (!body?.venueId || !body?.provider || !Array.isArray(body?.punches) || !connectionSecret) {
      return new Response('Bad request', { status: 400 });
    }
    try {
      await ctx.runMutation(internal.pos.ingestLaborPunches, {
        venueId: body.venueId,
        provider: body.provider,
        punches: body.punches,
        connectionSecret,
      });
    } catch (e) {
      return new Response('Rejected', { status: 400 });
    }
    return new Response('ok', { status: 200 });
  }),
});

http.route({
  path: '/reservations/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    if (!secretOk(process.env.RESERVATION_WEBHOOK_SECRET, req.headers.get('x-venueflow-reservation-secret'))) {
      return new Response('Unauthorized', { status: 401 });
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }
    const connectionSecret = req.headers.get('x-venueflow-connection-secret');
    if (!body?.venueId || !body?.provider || !body?.reservation || !connectionSecret) return new Response('Bad request', { status: 400 });
    try {
      await ctx.runMutation(internal.reservationIntegrations.ingestExternalReservation, {
        venueId: body.venueId,
        provider: body.provider,
        reservation: body.reservation,
        connectionSecret,
        externalVenueId: typeof body.externalVenueId === 'string' ? body.externalVenueId : undefined,
      });
    } catch (e) {
      return new Response('Rejected', { status: 400 });
    }
    return new Response('ok', { status: 200 });
  }),
});

// RevenueCat server notifications. Configure this URL + an Authorization header
// value (REVENUECAT_WEBHOOK_AUTH) in the RevenueCat dashboard. The app_user_id
// is the venue id, so events map straight onto the venue's subscription.
const REVENUECAT_ACTIVE_TYPES = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE']);
http.route({
  path: '/revenuecat/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
    const received = req.headers.get('authorization');
    if (!secretOk(expected, received)) return new Response('Unauthorized', { status: 401 });
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }
    const event = body?.event;
    const appUserId: string | undefined = event?.app_user_id;
    const type: string | undefined = event?.type;
    if (!appUserId || !type) return new Response('ok', { status: 200 });
    const status = REVENUECAT_ACTIVE_TYPES.has(type)
      ? 'active'
      : type === 'BILLING_ISSUE'
        ? 'past_due'
        : type === 'EXPIRATION'
          ? 'expired'
          : null;
    if (status) {
      try {
        await ctx.runMutation(internal.billing.handleRevenueCatEvent, { appUserId, status: status as any });
      } catch {
        // Unknown app_user_id (not a venue) — ignore.
      }
    }
    return new Response('ok', { status: 200 });
  }),
});

export default http;
