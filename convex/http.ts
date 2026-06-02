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
