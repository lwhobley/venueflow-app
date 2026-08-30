import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `getCurrentPositionAsync({ accuracy: BestForNavigation })` was awaited with no
 * timeout and no cached-fix fallback. Indoors it can take tens of seconds or
 * never settle, and the clock screen holds its loading state — and the punch
 * button — for exactly that long, with no retry short of leaving the tab.
 */

const mocks = vi.hoisted(() => ({
  hasServicesEnabledAsync: vi.fn(),
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn(),
}));

vi.mock('expo-location', () => ({
  hasServicesEnabledAsync: mocks.hasServicesEnabledAsync,
  requestForegroundPermissionsAsync: mocks.requestForegroundPermissionsAsync,
  getCurrentPositionAsync: mocks.getCurrentPositionAsync,
  getLastKnownPositionAsync: mocks.getLastKnownPositionAsync,
  Accuracy: { BestForNavigation: 6 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied' },
}));

const {
  getPreciseLocation,
  LocationPermissionDeniedError,
  LocationServicesDisabledError,
  LocationUnavailableError,
} = await import('./location');

const fix = (accuracy: number) => ({
  coords: { latitude: 40.7, longitude: -74.0, accuracy },
  mocked: false,
});

describe('getPreciseLocation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.hasServicesEnabledAsync.mockResolvedValue(true);
    mocks.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mocks.getLastKnownPositionAsync.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a fresh fix without consulting the cache', async () => {
    mocks.getCurrentPositionAsync.mockResolvedValue(fix(8));

    const result = await getPreciseLocation();

    expect(result).toEqual({ latitude: 40.7, longitude: -74.0, accuracy: 8, mocked: false });
    expect(mocks.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });

  it('falls back to a recent cached fix when the fresh one never arrives', async () => {
    // The exact failure: a promise that simply never settles.
    mocks.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}));
    mocks.getLastKnownPositionAsync.mockResolvedValue(fix(35));

    const pending = getPreciseLocation();
    await vi.advanceTimersByTimeAsync(12_000);
    const result = await pending;

    expect(result.accuracy).toBe(35);
    // The cached fix must still clear the server's 50m rule and be recent
    // enough to evidence presence at the venue.
    expect(mocks.getLastKnownPositionAsync).toHaveBeenCalledWith({ maxAge: 60_000, requiredAccuracy: 50 });
  });

  it('does not resolve before the timeout elapses', async () => {
    mocks.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}));
    mocks.getLastKnownPositionAsync.mockResolvedValue(fix(20));
    let settled = false;

    const pending = getPreciseLocation().then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(11_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(settled).toBe(true);
  });

  it('reports an actionable error when neither a fresh nor cached fix exists', async () => {
    mocks.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}));
    mocks.getLastKnownPositionAsync.mockResolvedValue(null);

    // Attach the handler before advancing timers, otherwise the rejection
    // lands with no listener and Vitest reports an unhandled error.
    const pending = getPreciseLocation().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(12_000);
    const error = await pending;

    expect(error).toBeInstanceOf(LocationUnavailableError);
    expect((error as Error).message).toMatch(/Step outside or near a window/);
  });

  it('falls back to the cache when the fresh lookup rejects outright', async () => {
    mocks.getCurrentPositionAsync.mockRejectedValue(new Error('kCLErrorDomain error 0'));
    mocks.getLastKnownPositionAsync.mockResolvedValue(fix(30));

    const pending = getPreciseLocation();
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toMatchObject({ accuracy: 30 });
  });

  it('still surfaces permission and service errors unchanged', async () => {
    mocks.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await expect(getPreciseLocation()).rejects.toBeInstanceOf(LocationPermissionDeniedError);

    mocks.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mocks.hasServicesEnabledAsync.mockResolvedValue(false);
    await expect(getPreciseLocation()).rejects.toBeInstanceOf(LocationServicesDisabledError);
  });
});
