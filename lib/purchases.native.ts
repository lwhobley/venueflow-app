// Native (iOS/Android) in-app purchases via RevenueCat. A single "pro"
// entitlement unlocks the app; all tiers grant it (they differ only by the
// staff-count limit shown at signup). Configure values via app.json -> extra
// or EXPO_PUBLIC_* env so no real keys live in source.
import Purchases from 'react-native-purchases';
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;
const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? extra.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const ENTITLEMENT = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT ?? extra.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT ?? 'pro';

export const PURCHASES_SUPPORTED = true;

export type PurchasePackage = {
  id: string;
  title: string;
  priceString: string;
  productId: string;
};

let configured = false;

export async function configurePurchases(appUserId?: string): Promise<void> {
  if (!IOS_KEY) {
    console.warn('[purchases] EXPO_PUBLIC_REVENUECAT_IOS_KEY not set — purchases disabled.');
    return;
  }
  try {
    if (!configured) {
      Purchases.configure({ apiKey: IOS_KEY, appUserID: appUserId ?? null });
      configured = true;
    } else if (appUserId) {
      await Purchases.logIn(appUserId);
    }
  } catch (e) {
    console.error('[purchases] configure failed:', e);
  }
}

export async function isPremiumActive(): Promise<boolean> {
  if (!IOS_KEY) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return Boolean(info.entitlements.active[ENTITLEMENT]);
  } catch {
    return false;
  }
}

export async function getOfferingPackages(): Promise<PurchasePackage[]> {
  if (!IOS_KEY) return [];
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
  const offerings = await Purchases.getOfferings();
  const pkg = offerings.current?.availablePackages.find((p) => p.identifier === id);
  if (!pkg) throw new Error('That plan is not available right now.');
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return Boolean(customerInfo.entitlements.active[ENTITLEMENT]);
}

export async function restorePurchases(): Promise<boolean> {
  const info = await Purchases.restorePurchases();
  return Boolean(info.entitlements.active[ENTITLEMENT]);
}
