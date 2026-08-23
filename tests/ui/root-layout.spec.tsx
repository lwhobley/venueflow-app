import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'ios' },
  fonts: [false, undefined] as [boolean, Error | undefined],
  auth: { authEpoch: 1, user: null, venue: null, token: null },
  cancelQueries: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn(),
  configurePurchases: vi.fn().mockResolvedValue(undefined),
  logoutPurchases: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('react-native', () => ({ Platform: mocks.platform, View: 'View' }));
vi.mock('expo-router', () => ({ Stack: 'Stack' }));
vi.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: 'GestureHandlerRootView' }));
vi.mock('@tanstack/react-query', () => ({ QueryClientProvider: 'QueryClientProvider' }));
vi.mock('react-native-paper', () => ({ PaperProvider: 'PaperProvider' }));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: { font: { MaterialCommunityIcons: 'font' } } }));
vi.mock('@sentry/react-native', () => ({ init: vi.fn(), captureException: vi.fn(), wrap: (component: unknown) => component }));
vi.mock('expo-font', () => ({ useFonts: () => mocks.fonts }));
vi.mock('@expo-google-fonts/fraunces', () => ({
  Fraunces_500Medium: 'Fraunces_500Medium',
  Fraunces_600SemiBold: 'Fraunces_600SemiBold',
  Fraunces_600SemiBold_Italic: 'Fraunces_600SemiBold_Italic',
}));
vi.mock('../../lib/a0-purchases-stub', () => ({ A0PurchaseProvider: 'A0PurchaseProvider' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' }));
vi.mock('../../lib/theme', () => ({
  makePaperTheme: () => ({}),
  useAppearanceStore: (selector: (state: { mode: string }) => unknown) => selector({ mode: 'light' }),
  designPalettes: { light: { background: '#fff' } },
}));
vi.mock('../../components/SubscriptionGate', () => ({ SubscriptionGate: 'SubscriptionGate' }));
vi.mock('../../components/ErrorBoundary', () => ({ ErrorBoundary: 'ErrorBoundary' }));
vi.mock('../../lib/auth-store', () => ({ useAuthStore: (selector: (state: typeof mocks.auth) => unknown) => selector(mocks.auth) }));
vi.mock('../../lib/purchases', () => ({
  configurePurchases: mocks.configurePurchases,
  logoutPurchases: mocks.logoutPurchases,
}));
vi.mock('../../lib/query-client', () => ({ queryClient: { cancelQueries: mocks.cancelQueries, clear: mocks.clear } }));
vi.mock('../../lib/report-error', () => ({ setFatalErrorReporter: vi.fn() }));

vi.stubGlobal('__DEV__', true);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { RootLayout } from '../../app/_layout';

describe('RootLayout bootstrap', () => {
  beforeEach(() => {
    mocks.platform.OS = 'ios';
    mocks.fonts = [false, undefined];
    vi.clearAllMocks();
  });

  it('mounts native navigation without waiting indefinitely for fonts', async () => {
    const renderer = createRoot();
    await act(async () => renderer.render(<RootLayout />));
    expect(JSON.stringify(renderer.container.toJSON())).toContain('Stack');
  });

  it('holds web first paint until fonts load or fail explicitly', async () => {
    mocks.platform.OS = 'web';
    const renderer = createRoot();
    await act(async () => renderer.render(<RootLayout />));
    expect(JSON.stringify(renderer.container.toJSON())).not.toContain('Stack');

    mocks.fonts = [true, undefined];
    await act(async () => renderer.render(<RootLayout />));
    expect(JSON.stringify(renderer.container.toJSON())).toContain('Stack');
  });
});
