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
const DIRECT_PRODUCT_IDS = [
  'com.venuewrangler.monthly',
  'com.venuewrangler.multivenue.399',
];

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

export const PURCHASES_SUPPORTED = Platform.OS === 'ios' && Boolean(EFFECTIVE_KEY);

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
    console.error('[purchases] configure failed:', e);
  }
}

export async function logoutPurchases(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch (e) {
    console.warn('[purchases] logOut failed:', e instanceof Error ? e.message : String(e));
  }
}

function hasPaidEntitlement(info: { entitlements: { active: Record<string, { productIdentifier?: string } | undefined> } }): { active: boolean; productId?: string; entitlementId?: string } {
  const active = info.entitlements.active;
  const match = active.pro
    ? { entitlementId: 'pro', productId: active.pro.productIdentifier }
    : active.multi_venue
      ? { entitlementId: 'multi_venue', productId: active.multi_venue.productIdentifier }
      : active[ENTITLEMENT]
        ? { entitlementId: ENTITLEMENT, productId: active[ENTITLEMENT]?.productIdentifier }
        : null;
  return match ? { active: true, productId: match.productId, entitlementId: match.entitlementId } : { active: false };
}

export async function isPremiumActive(): Promise<boolean> {
  if (!configured) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return hasPaidEntitlement(info).active;
  } catch (e) {
    console.warn('[purchases] isPremiumActive check failed:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

export async function getOfferingPackages(): Promise<PurchasePackage[]> {
  if (!configured) return [];
  const offerings = await Purchases.getOfferings();
  const packages = (offerings.current?.availablePackages ?? []).map((p) => ({
    id: p.identifier,
    title: p.product.title,
    priceString: p.product.priceString,
    productId: p.product.identifier,
  }));

  // A RevenueCat offering can lag behind App Store Connect configuration.
  // Query the two supported StoreKit products directly so a valid multi-venue
  // product stays visible and purchasable even before it is added to the
  // current offering. StoreKit supplies the localized title and price.
  try {
    const products = await Purchases.getProducts(DIRECT_PRODUCT_IDS);
    for (const product of products) {
      if (packages.some((pkg) => pkg.productId === product.identifier)) continue;
      packages.push({
        id: product.identifier,
        title: product.title,
        priceString: product.priceString,
        productId: product.identifier,
      });
    }
  } catch (e) {
    console.warn('[purchases] direct product lookup failed:', e instanceof Error ? e.message : String(e));
  }

  return packages;
}

export async function purchasePackageById(id: string, productId?: string): Promise<boolean> {
  if (!configured) throw new Error('Purchases are not available right now.');
  const offerings = await Purchases.getOfferings();
  const pkg = offerings.current?.availablePackages.find(
    (candidate) => candidate.identifier === id || candidate.product.identifier === productId,
  );
  if (pkg) {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return hasPaidEntitlement(customerInfo).active;
  }

  const targetProductId = productId || id;
  const products = await Purchases.getProducts([targetProductId]);
  const product = products.find((candidate) => candidate.identifier === targetProductId);
  if (!product) throw new Error('That plan is not available right now.');
  const { customerInfo } = await Purchases.purchaseStoreProduct(product);
  return hasPaidEntitlement(customerInfo).active;
}

export async function restorePurchases(): Promise<{ active: boolean; productId?: string; entitlementId?: string }> {
  if (!configured) return { active: false };
  const info = await Purchases.restorePurchases();
  return hasPaidEntitlement(info);
}
