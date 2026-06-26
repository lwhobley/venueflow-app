// Minimal form-encoded Stripe REST client, matching the SDK-free style of the
// webhook handler (which verifies signatures manually). Only covers what the
// web checkout flow needs: create checkout + billing-portal sessions and
// look up / create the subscription price.

const STRIPE_API = 'https://api.stripe.com/v1';

// Stripe expects nested params as bracketed form keys, e.g.
// line_items[0][price]=... and metadata[venueId]=...
function encode(params: Record<string, unknown>, prefix = ''): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const k = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v !== null && typeof v === 'object') {
          parts.push(...encode(v as Record<string, unknown>, `${k}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${k}[${i}]`)}=${encodeURIComponent(String(v))}`);
        }
      });
    } else if (typeof value === 'object') {
      parts.push(...encode(value as Record<string, unknown>, k));
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
}

export async function stripeRequest<T = any>(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const body = params ? encode(params).join('&') : undefined;
  const url = method === 'GET' && body ? `${STRIPE_API}${path}?${body}` : `${STRIPE_API}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'POST' ? body : undefined,
  });
  const json: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Stripe ${path} failed: ${json?.error?.message ?? response.statusText}`);
  }
  return json as T;
}
