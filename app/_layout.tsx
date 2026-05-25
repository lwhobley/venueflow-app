import { useEffect, useMemo } from 'react';
import { Platform, useColorScheme, View } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaperProvider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { A0PurchaseProvider } from '../lib/a0-purchases-stub';
import { ConvexReactClient } from 'convex/react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { lightTheme, darkTheme, colors } from '../lib/theme';
import { SubscriptionGate } from '../components/SubscriptionGate';
import { useAuthStore, type AuthState } from '../lib/auth-store';
import { configurePurchases } from '../lib/purchases';

const convexUrl =
  process.env.EXPO_PUBLIC_CONVEX_URL ??
  // Fall back to the value baked into app.json -> expo.extra. This keeps web
  // builds working even when a gitignored .env.local is absent (e.g. a fresh
  // clone or git worktree), where EXPO_PUBLIC_* vars are not inlined.
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_CONVEX_URL as string | undefined) ??
  (globalThis as typeof globalThis & { EXPO_PUBLIC_CONVEX_URL?: string }).EXPO_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  // Surface a clear error rather than letting ConvexReactClient throw a less obvious one.
  // EXPO_PUBLIC_CONVEX_URL must be set in .env (or app.config).
  console.warn('[Venue Wrangler] EXPO_PUBLIC_CONVEX_URL is not set; Convex queries will fail.');
}

const convexClient = new ConvexReactClient(convexUrl ?? 'https://missing-convex-url.invalid', {
  unsavedChangesWarning: false,
});

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const shouldIgnoreWebError = (message: string) =>
  message.includes('ResizeObserver loop completed with undelivered notifications') ||
  message.includes('ResizeObserver loop limit exceeded') ||
  message.includes("Failed to execute 'importScripts' on 'WorkerGlobalScope'") ||
  message.includes('monaco-editor') ||
  message.includes('ts.worker');

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Preload the MaterialCommunityIcons glyph font so icons render on web (Paper
  // and the nav use it). We hold the first paint until it's loaded, otherwise
  // web shows blank "tofu" squares. A load error still lets the app through.
  const [fontsLoaded, fontError] = useFonts(MaterialCommunityIcons.font);
  // Only block the first paint on web (where an unloaded glyph font shows tofu
  // squares). On native the icon font is bundled and renders fine, so never
  // gate there — a gate could leave a blank screen if loading misbehaves.
  const fontsReady = Platform.OS !== 'web' || fontsLoaded || !!fontError;
  const queryClient = useMemo(() => new QueryClient(), []);
  const userId = useAuthStore((state: AuthState) => state.user?.id ?? null);
  const venueId = useAuthStore((state: AuthState) => state.venue?.id ?? null);

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

  if (!fontsReady) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ConvexAuthProvider client={convexClient} storage={Platform.OS === 'web' ? undefined : secureStorage}>
          <QueryClientProvider client={queryClient}>
            <PaperProvider theme={colorScheme === 'dark' ? darkTheme : lightTheme}>
              <A0PurchaseProvider config={{ appUserId: userId ?? undefined, debug }}>
                {/* Top inset keeps content below the status bar / notch; the tab
                    bar and screens handle the bottom inset. */}
                <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
                  <SubscriptionGate>
                    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
                  </SubscriptionGate>
                </SafeAreaView>
              </A0PurchaseProvider>
            </PaperProvider>
          </QueryClientProvider>
        </ConvexAuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
