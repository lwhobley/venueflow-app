import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The time clock is the app's daily action and the origin of every payroll
 * figure, and it had no test at any level. These cover the branches that decide
 * whether a punch is sent at all: geofence inside/outside, a location fix that
 * never arrives, permission refusal, and the double-tap guard.
 */

const state = vi.hoisted(() => ({
  clockIn: vi.fn().mockResolvedValue(undefined),
  clockOut: vi.fn().mockResolvedValue(undefined),
  breakStart: vi.fn().mockResolvedValue(undefined),
  breakEnd: vi.fn().mockResolvedValue(undefined),
  createRequest: vi.fn().mockResolvedValue(undefined),
  getPreciseLocation: vi.fn(),
  isWithinGeofence: vi.fn().mockReturnValue(true),
  attestPayload: vi.fn().mockResolvedValue(null),
  resetAttestationKey: vi.fn().mockResolvedValue(undefined),
  alert: vi.fn(),
  venue: { id: 'venue-1', name: 'The Fox & Vine', latitude: 40.7, longitude: -74, geofenceRadiusM: 120 },
  timeClock: { isClockedIn: false, openSince: null, punches: [] } as any,
  clockBoard: { activeClockEntries: [], managerAlerts: [], employeeEntry: null } as any,
  dashboard: { profile: { role: 'server', allAccess: false }, venue: null } as any,
}));

const FIX = { latitude: 40.7001, longitude: -74.0001, accuracy: 8, mocked: false };

vi.mock('expo-router', () => ({ router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success' },
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'Icon' }));
vi.mock('react-native', () => ({
  Alert: { alert: (...args: unknown[]) => state.alert(...args) },
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('react-native-paper', async () => {
  const R = await import('react');
  const element = (type: string) => ({ children, ...props }: any) => R.createElement(type, props, children);
  const Card = Object.assign(element('Card'), { Content: element('Card.Content') });
  return { Card, Text: element('Text') };
});
vi.mock('../../lib/location', () => ({
  getPreciseLocation: () => state.getPreciseLocation(),
  isWithinGeofence: (...args: unknown[]) => state.isWithinGeofence(...args),
}));
vi.mock('../../lib/attestation', () => ({
  attestPayload: (...args: unknown[]) => state.attestPayload(...args),
  resetAttestationKey: () => state.resetAttestationKey(),
}));
vi.mock('../../lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; }
  },
  appApi: { createStaffRequest: 'createStaffRequest' },
  useApiMutation: () => state.createRequest,
}));
vi.mock('../../lib/railway-hooks', () => ({
  useQuery: (ref: string) =>
    ref === 'getClockBoard' ? state.clockBoard
    : ref === 'getDashboard' ? state.dashboard
    : ref === 'getMyTimeClock' ? state.timeClock
    : undefined,
  useMutation: (ref: string) =>
    ref === 'clockIn' ? state.clockIn
    : ref === 'clockOut' ? state.clockOut
    : ref === 'breakStart' ? state.breakStart
    : state.breakEnd,
}));
vi.mock('../../lib/railway-api', () => ({
  api: {
    app: {
      getClockBoard: 'getClockBoard', getDashboard: 'getDashboard', getMyTimeClock: 'getMyTimeClock',
      clockIn: 'clockIn', clockOut: 'clockOut', breakStart: 'breakStart', breakEnd: 'breakEnd',
    },
  },
}));
vi.mock('../../lib/auth-store', () => ({
  useAuthStore: (selector: (value: unknown) => unknown) =>
    selector({ user: { id: 'user-1', full_name: 'Marcus Delacroix' }, venue: state.venue }),
}));
vi.mock('../../lib/auth-readiness', () => ({ useAuthenticatedSession: () => ({ isReady: true }) }));
vi.mock('../../lib/permissions', () => ({ canManageVenue: (role: string) => ['admin', 'owner', 'manager'].includes(role) }));
vi.mock('../../lib/session-from-auth', () => ({ venueFromApi: (v: any) => v }));
vi.mock('../../lib/zoned-datetime', () => ({ overnightAwareRange: () => ({ start: 0, end: 0 }) }));
vi.mock('../../lib/format', () => ({
  formatTime: (ms: number) => String(ms),
  errorMessage: (error: any, fallback: string) => error?.message ?? fallback,
}));
vi.mock('../../lib/theme', () => ({
  accents: Array.from({ length: 5 }, (_, i) => ({ bg: `#bg${i}`, fg: `#fg${i}`, icon: `#ic${i}` })),
  colors: {
    background: '#000', border: '#333', charcoal: '#222', danger: '#f00', muted: '#777',
    primary: '#0f0', secondary: '#00f', surface: '#111',
  },
  radius: { sharp: 4, md: 8 },
  spacing: { lg: 24, md: 16, sm: 8, xs: 4, xl: 32, xxl: 48 },
}));
vi.mock('../../lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock('../../components/ErrorBoundary', () => ({ ScreenErrorBoundary: ({ children }: any) => children }));

import ClockScreen from '../../app/(tabs)/clock';

function punchButton(renderer: ReturnType<typeof createRoot>) {
  return renderer.container
    .queryAll((node) => node.type === 'Pressable')
    .find((node) => {
      const json = JSON.stringify(node.toJSON());
      return json.includes('clock.punchNow') || json.includes('clock.punchOut') || json.includes('clock.working');
    });
}

async function renderScreen() {
  const renderer = createRoot();
  await act(async () => renderer.render(<ClockScreen />));
  return renderer;
}

describe('Clock screen punching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getPreciseLocation.mockResolvedValue(FIX);
    state.isWithinGeofence.mockReturnValue(true);
    state.attestPayload.mockResolvedValue(null);
    state.timeClock = { isClockedIn: false, openSince: null, punches: [] };
    state.clockBoard = { activeClockEntries: [], managerAlerts: [], employeeEntry: null };
    state.dashboard = { profile: { role: 'server', allAccess: false }, venue: null };
  });

  it('sends a clock-in with the freshly re-read fix, not the one cached at mount', async () => {
    const renderer = await renderScreen();
    const fresher = { latitude: 40.7002, longitude: -74.0002, accuracy: 6, mocked: false };
    state.getPreciseLocation.mockResolvedValueOnce(fresher);

    await act(async () => punchButton(renderer)?.props.onPress());

    expect(state.clockIn).toHaveBeenCalledTimes(1);
    expect(state.clockIn).toHaveBeenCalledWith({
      lat: fresher.latitude, lng: fresher.longitude, accuracy: fresher.accuracy, mocked: false,
    });
    expect(state.clockOut).not.toHaveBeenCalled();
  });

  it('refuses to punch outside the geofence and says why', async () => {
    state.isWithinGeofence.mockReturnValue(false);
    const renderer = await renderScreen();

    await act(async () => punchButton(renderer)?.props.onPress());

    expect(state.clockIn).not.toHaveBeenCalled();
    expect(state.alert).toHaveBeenCalledWith('clock.punchFailedTitle', expect.stringContaining('clock.mustBeWithin'));
  });

  it('clocks out when already clocked in', async () => {
    state.timeClock = { isClockedIn: true, openSince: 1, punches: [] };
    const renderer = await renderScreen();

    await act(async () => punchButton(renderer)?.props.onPress());

    expect(state.clockOut).toHaveBeenCalledTimes(1);
    expect(state.clockIn).not.toHaveBeenCalled();
  });

  it('surfaces a server rejection instead of failing silently', async () => {
    state.clockIn.mockRejectedValueOnce(new Error('Already clocked in'));
    const renderer = await renderScreen();

    await act(async () => punchButton(renderer)?.props.onPress());

    expect(state.alert).toHaveBeenCalledWith('clock.punchFailedTitle', 'Already clocked in');
  });

  it('does not double-submit when the button is tapped twice', async () => {
    let release!: () => void;
    state.clockIn.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const renderer = await renderScreen();

    const button = punchButton(renderer);
    await act(async () => {
      button?.props.onPress();
      button?.props.onPress();
      await Promise.resolve();
    });

    expect(state.clockIn).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });

  it('reports a location failure rather than sending a punch without one', async () => {
    state.getPreciseLocation.mockRejectedValue(new Error('Location permission is required for geofenced clock-in.'));
    const renderer = await renderScreen();

    await act(async () => punchButton(renderer)?.props.onPress());

    expect(state.clockIn).not.toHaveBeenCalled();
    expect(state.alert).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Location permission is required'),
    );
  });

  it('attaches an attestation assertion when the device can produce one', async () => {
    const assertion = { keyId: 'key-1', assertion: 'sig', challenge: 'nonce' };
    state.attestPayload.mockResolvedValueOnce(assertion);
    const renderer = await renderScreen();

    await act(async () => punchButton(renderer)?.props.onPress());

    expect(state.clockIn).toHaveBeenCalledWith(expect.objectContaining({ attestation: assertion }));
  });

  it('hides the punch control from salaried managers', async () => {
    state.dashboard = { profile: { role: 'manager', allAccess: false }, venue: null };
    const renderer = await renderScreen();

    expect(punchButton(renderer)).toBeUndefined();
  });
});
