// iOS in-app purchases via RevenueCat. A single "pro" entitlement unlocks the
// app; all tiers grant it (they differ only by the staff-count limit shown at
// signup). The public SDK key may be set in eas.json or EXPO_PUBLIC_* env
// vars. Android is not a purchase platform — on Android the
// key is empty and purchases are disabled.
import Purchases from 'react-native-purchases';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;
const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? extra.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const ENTITLEMENT = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT ?? extra.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT ?? 'pro';

const API_KEY = Platform.OS === 'ios' ? IOS_KEY : '';

// RevenueCat Test Store keys (test_...) only work in development builds
// (Expo Go / simulator). In a release/TestFlight build, Purchases.configure
// crashes natively on a test key — which a JS try/catch can't catch. So we
// only honor a test key when __DEV__ is true; release builds need a real
// key. This keeps the app launchable even if a test key is shipped.
const isTestKey = API_KEY.startsWith('test_');
const isDev = Boolean((globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__);
// The effective key the SDK may be configured with. Empty => purchases off.
const EFFECTIVE_KEY = isTestKey && !isDev ? '' : API_KEY;

export const PURCHASES_SUPPORTED = true;

export type PurchasePackage = {
  id: string;
  title: string;
  priceString: string;
  productId: string;
};

let configured = false;

export async function configurePurchases(appUserId?: string): Promise<void> {
  if (!EFFECTIVE_KEY) {
    if (isTestKey) {
      if (isDev) console.warn('[purchases] Test Store key ignored in release build — purchases disabled. Use a production key for TestFlight/production.');
    } else {
      if (isDev) console.warn(`[purchases] EXPO_PUBLIC_REVENUECAT_${Platform.OS.toUpperCase()}_KEY not set — purchases disabled.`);
    }
    return;
  }
  try {
    if (!configured) {
      Purchases.configure({ apiKey: EFFECTIVE_KEY, appUserID: appUserId ?? null });
      configured = true;
    } else if (appUserId) {
      await Purchases.logIn(appUserId);
    }
  } catch (e) {
    if (isDev) console.error('[purchases] configure failed:', e);
  }
}

export async function isPremiumActive(): Promise<boolean> {
  if (!configured) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return Boolean(info.entitlements.active[ENTITLEMENT]);
  } catch {
    return false;
  }
}

export async function getOfferingPackages(): Promise<PurchasePackage[]> {
  if (!configured) return [];
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return [];
  return current.availablePackages.map((p) => ({
    id: p.identifier,
    title: p.product.title,
    priceString: p.product.priceString,
    productId: p.product.identifier,
  }));
}

export async function purchasePackageById(id: string): Promise<boolean> {
  if (!configured) throw new Error('Purchases are not available right now.');
  const offerings = await Purchases.getOfferings();
  const pkg = offerings.current?.availablePackages.find((p) => p.identifier === id);
  if (!pkg) throw new Error('That plan is not available right now.');
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return Boolean(customerInfo.entitlements.active[ENTITLEMENT]);
}

export async function restorePurchases(): Promise<boolean> {
  if (!configured) return false;
  const info = await Purchases.restorePurchases();
  return Boolean(info.entitlements.active[ENTITLEMENT]);
}
