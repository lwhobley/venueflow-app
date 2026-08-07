import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { EXPO_PUBLIC_API_URL: 'https://api.example.test' } } },
}));

vi.mock('./auth-store', () => {
  const state = { token: null, authEpoch: 0, user: null, venue: null, clearSession: vi.fn() };
  const store = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return { useAuthStore: store };
});

import { ApiError, apiRequest, appApi } from './api-client';

function abortableFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (init?.signal?.aborted) rejectAbort();
    else init?.signal?.addEventListener('abort', rejectAbort, { once: true });
  }));
}

describe('apiRequest cancellation', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('preserves caller cancellation instead of reporting a timeout', async () => {
    vi.stubGlobal('fetch', abortableFetch());
    const controller = new AbortController();

    const request = apiRequest('/cancelled', { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await expect(request).rejects.not.toBeInstanceOf(ApiError);
  });

  it('maps only the internal deadline to an HTTP 408 error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', abortableFetch());

    const request = apiRequest('/slow', { timeoutMs: 100 });
    const assertion = expect(request).rejects.toMatchObject({ name: 'ApiError', status: 408 });
    await vi.advanceTimersByTimeAsync(100);

    await assertion;
  });

  it('propagates a signal that was already aborted', async () => {
    vi.stubGlobal('fetch', abortableFetch());
    const controller = new AbortController();
    controller.abort();

    await expect(apiRequest('/already-cancelled', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('appApi billing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the selected multi-venue plan to Stripe checkout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ url: 'https://checkout.example.test' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(appApi.createStripeCheckout({ plan: 'multi_venue' }))
      .resolves.toEqual({ url: 'https://checkout.example.test' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/app/billing/stripe/checkout',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ plan: 'multi_venue' }) }),
    );
  });
});
