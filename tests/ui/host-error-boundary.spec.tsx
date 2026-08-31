import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

/**
 * F-2 regression: most screens' data hooks (useQuery/useQueryState) throw on
 * a first-load failure by design (see railway-hooks.ts), but 22 of 28 screens
 * that call them had no screen-level error boundary — a failed request on
 * any of them replaced the *entire app* with the root boundary's crash
 * screen instead of just that screen. Every such screen was wrapped in
 * ScreenErrorBoundary; this proves the wrapping actually works end to end
 * (real ErrorBoundary, not mocked) rather than just checking the source has
 * the right import. HostStandScreen is used here as a small, representative
 * case — its screen file also lists which decorators/hooks a "does this
 * boundary actually catch" test needs to stub.
 */
vi.mock('expo-router', () => ({
  useRouter: () => ({ back: vi.fn() }),
  // ErrorBoundary itself (not mocked here — this test verifies the real one
  // catches the thrown error) imports the `router` singleton directly.
  router: { replace: vi.fn() },
}));
vi.mock('react-native', () => ({
  // ScreenErrorBoundary now renders DesktopFrame, which needs these.
  // Phone-sized so these specs keep exercising the mobile layout.
  Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  ScrollView: 'ScrollView',
  View: 'View',
}));
vi.mock('react-native-paper', async () => {
  const ReactModule = await import('react');
  const element = (type: string) => ({ children, ...props }: any) => ReactModule.createElement(type, props, children);
  return { Button: element('Button'), Chip: element('Chip'), Text: element('Text') };
});
vi.mock('../../components/AppCard', async () => {
  const ReactModule = await import('react');
  const element = (type: string) => ({ children, ...props }: any) => ReactModule.createElement(type, props, children);
  return { AppCard: element('AppCard'), SectionHeader: element('SectionHeader') };
});
vi.mock('../../lib/railway-api', () => ({ api: { floor: { getActiveFloorPlan: 'getActiveFloorPlan', getFloorStats: 'getFloorStats' } } }));
vi.mock('../../lib/auth-store', () => ({
  useAuthStore: (selector: (value: unknown) => unknown) => selector({ venue: { id: 'venue-1', name: 'Test Venue' } }),
}));
vi.mock('../../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/theme', () => ({
  colors: { background: '#000', danger: '#f00', muted: '#777', primary: '#fff', surface: '#111', charcoal: '#222', border: '#333' },
  radius: { soft: 8, lg: 12 },
  spacing: { lg: 24, md: 16, sm: 8, xl: 32, xxl: 48 },
  type: { title: {} },
}));

const useQuery = vi.fn();
vi.mock('../../lib/railway-hooks', () => ({ useQuery: (...args: unknown[]) => useQuery(...args) }));

import HostStandScreenWrapper from '../../app/host';

describe('HostStandScreen error boundary', () => {
  it('renders normally when the floor/stats queries succeed', async () => {
    useQuery.mockReturnValue(undefined);
    const renderer = createRoot();

    await act(async () => renderer.render(<HostStandScreenWrapper />));

    const output = JSON.stringify(renderer.container.toJSON());
    expect(output).not.toContain('Something went wrong');
  });

  it('shows the recoverable fallback instead of crashing when a data hook throws', async () => {
    // Mirrors what useQuery actually does on a first-load failure
    // (railway-hooks.ts: throwOnError when query.state.data === undefined).
    useQuery.mockImplementation(() => {
      throw new Error('Network request failed');
    });
    const renderer = createRoot();

    await act(async () => renderer.render(<HostStandScreenWrapper />));

    const output = JSON.stringify(renderer.container.toJSON());
    expect(output).toContain('Something went wrong');
    expect(output).toContain('Back to Home');
  });
});
