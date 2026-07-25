import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaperProvider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import {
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_600SemiBold_Italic,
} from '@expo-google-fonts/fraunces';
import { A0PurchaseProvider } from '../lib/a0-purchases-stub';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { makePaperTheme, useAppearanceStore, designPalettes } from '../lib/theme';
import { SubscriptionGate } from '../components/SubscriptionGate';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useAuthStore, type AuthState } from '../lib/auth-store';
import { consumeWebHandoff } from '../lib/web-handoff';
import { configurePurchases } from '../lib/purchases';
import { DesktopWebStyles } from '../components/DesktopWebStyles';

const shouldIgnoreWebError = (message: string) =>
  message.includes('ResizeObserver loop completed with undelivered notifications') ||
  message.includes('ResizeObserver loop limit exceeded') ||
  message.includes("Failed to execute 'importScripts' on 'WorkerGlobalScope'") ||
  message.includes('monaco-editor') ||
  message.includes('ts.worker');

export default function RootLayout() {
  const themeMode = useAppearanceStore((state) => state.mode);
  const palette = designPalettes[themeMode];
  // Preload application fonts, but never block the web shell on them. A CDN or
  // hosting font failure must not leave authentication routes permanently blank.
  useFonts({
    ...MaterialCommunityIcons.font,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_600SemiBold_Italic,
  });
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10000, // 10 seconds
            gcTime: 300000, // 5 minutes (standard cacheTime replacement in TanStack v5)
          },
        },
      }),
    [],
  );
  const venueId = useAuthStore((state: AuthState) => state.venue?.id ?? null);
  const storeHydrated = useAuthStore((state: AuthState) => state.hydrated);
  const authScopeKey = useAuthStore(
    (state: AuthState) => `${state.authEpoch}:${state.user?.id ?? 'anon'}:${state.venue?.id ?? 'none'}`,
  );
  const lastAuthScopeKey = useRef<string | null>(null);

  useEffect(() => {
    if (lastAuthScopeKey.current === authScopeKey) return;
    lastAuthScopeKey.current = authScopeKey;
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [authScopeKey, queryClient]);

  // Consume a session handed off from the marketing site (venuewrangler.com) so
  // a user who just created a workspace lands signed in. Runs after the store
  // rehydrates so persist can't race-overwrite the adopted token. Native skips.
  const [handoffChecked, setHandoffChecked] = useState(Platform.OS !== 'web');
  const handoffStartedRef = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || handoffChecked || !storeHydrated || handoffStartedRef.current) return;
    handoffStartedRef.current = true;
    void consumeWebHandoff().finally(() => setHandoffChecked(true));
  }, [handoffChecked, storeHydrated]);


  // Initialize in-app purchases (RevenueCat) keyed to the venue so a purchase
  // ties to the tenant. No-op on web and when no key is configured.
  useEffect(() => {
    void configurePurchases(venueId ?? undefined);
  }, [venueId]);
  const debug = Boolean((globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;

    const globalObject = globalThis as typeof globalThis & {
      addEventListener?: typeof globalThis.addEventListener;
      removeEventListener?: typeof globalThis.removeEventListener;
    };

    const handleError = (event: Event) => {
      const errorEvent = event as ErrorEvent;
      const message = errorEvent.message || errorEvent.error?.message || '';
      if (shouldIgnoreWebError(message)) {
        errorEvent.preventDefault();
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = typeof reason === 'string' ? reason : reason?.message ?? '';
      if (shouldIgnoreWebError(message)) {
        event.preventDefault();
      }
    };

    globalObject.addEventListener?.('error', handleError);
    globalObject.addEventListener?.('unhandledrejection', handleUnhandledRejection);

    return () => {
      globalObject.removeEventListener?.('error', handleError);
      globalObject.removeEventListener?.('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  if (!handoffChecked) {
    return <View style={{ flex: 1, backgroundColor: palette.background }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <PaperProvider theme={makePaperTheme(themeMode)}>
            <DesktopWebStyles />
            <A0PurchaseProvider config={{ appUserId: venueId ?? undefined, debug }}>
              {/* Top inset keeps content below the status bar / notch; the tab
                  bar and screens handle the bottom inset. */}
              <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={['top', 'left', 'right']}>
                <ErrorBoundary>
                  <SubscriptionGate>
                    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.background } }} />
                  </SubscriptionGate>
                </ErrorBoundary>
              </SafeAreaView>
            </A0PurchaseProvider>
          </PaperProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
