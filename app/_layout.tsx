import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';
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
import { configurePurchases, logoutPurchases } from '../lib/purchases';
import { DesktopWebStyles } from '../components/DesktopWebStyles';
import { queryClient } from '../lib/query-client';
import { SportsBrandIntro } from '../components/SportsBrandIntro';

const shouldIgnoreWebError = (message: string) =>
  message.includes('ResizeObserver loop completed with undelivered notifications') ||
  message.includes('ResizeObserver loop limit exceeded') ||
  message.includes("Failed to execute 'importScripts' on 'WorkerGlobalScope'") ||
  message.includes('monaco-editor') ||
  message.includes('ts.worker');

export default function RootLayout() {
  const [showSportsIntro, setShowSportsIntro] = useState(Platform.OS === 'web');
  const themeMode = useAppearanceStore((state) => state.mode);
  const palette = designPalettes[themeMode];
  // Preload the MaterialCommunityIcons glyph font so icons render on web (Paper
  // and the nav use it). We hold the first paint until it's loaded, otherwise
  // web shows blank "tofu" squares. A load error still lets the app through.
  const [fontsLoaded, fontError] = useFonts({
    ...MaterialCommunityIcons.font,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_600SemiBold_Italic,
  });

  // Only block the first paint on web (where an unloaded glyph font shows tofu
  // squares). On native the icon font is bundled and renders fine, so never
  // gate there — a gate could leave a blank screen if loading misbehaves.
  const fontsReady = Platform.OS !== 'web' || fontsLoaded || !!fontError;
  const authScopeKey = useAuthStore(
    (state: AuthState) => `${state.authEpoch}:${state.user?.id ?? 'anon'}:${state.venue?.id ?? 'none'}`,
  );
  const venueId = useAuthStore((state: AuthState) => state.venue?.id ?? null);
  const token = useAuthStore((state: AuthState) => state.token);
  const storeHydrated = useAuthStore((state: AuthState) => state.hydrated);
  const lastAuthScopeKey = useRef<string | null>(null);

  useEffect(() => {
    if (lastAuthScopeKey.current === authScopeKey) return;
    lastAuthScopeKey.current = authScopeKey;
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [authScopeKey]);

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

  useEffect(() => {
    if (lastAuthScopeKey.current === authScopeKey) return;
    lastAuthScopeKey.current = authScopeKey;
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [authScopeKey]);

  useEffect(() => {
    if (!token) {
      void logoutPurchases();
      return;
    }
    void configurePurchases(venueId ?? undefined);
  }, [token, venueId]);
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
      {showSportsIntro ? <SportsBrandIntro onComplete={() => setShowSportsIntro(false)} /> : null}
    </GestureHandlerRootView>
  );
}
