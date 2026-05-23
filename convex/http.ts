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
    if (!body?.venueId || !body?.provider || !body?.check) return new Response('Bad request', { status: 400 });
    try {
      await ctx.runMutation(internal.pos.ingestPosCheck, { venueId: body.venueId, provider: body.provider, check: body.check });
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
    if (!body?.venueId || !body?.provider || !body?.reservation) return new Response('Bad request', { status: 400 });
    try {
      await ctx.runMutation(internal.reservationIntegrations.ingestExternalReservation, { venueId: body.venueId, provider: body.provider, reservation: body.reservation });
    } catch (e) {
      return new Response('Rejected', { status: 400 });
    }
    return new Response('ok', { status: 200 });
  }),
});

// Site-creator approval link target. GET /approveVenue?token=...
http.route({
  path: '/approveVenue',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).searchParams.get('token') ?? '';
    const page = (title: string, body: string) =>
      new Response(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title></head>
         <body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#F4FAFC;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;">
         <div style="background:#fff;border-radius:20px;padding:40px;max-width:440px;text-align:center;box-shadow:0 12px 40px rgba(8,35,63,0.12);">
         <h2 style="color:#0B2B4C;margin-top:0;">${title}</h2>${body}</div></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );

    if (!token) return page('Invalid link', '<p style="color:#607789;">This approval link is missing its token.</p>');
    const result = await ctx.runMutation(internal.approvals.approveByToken, { token });
    if (!result) return page('Link expired', '<p style="color:#607789;">This venue is already approved or the link is no longer valid.</p>');
    return page('Venue approved', `<p style="color:#607789;"><strong>${result.name}</strong> is now approved and can use VenueFlow.</p>`);
  }),
});

export default http;
