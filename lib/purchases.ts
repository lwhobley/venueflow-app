// Web / default implementation — no-op. In-app purchases are iOS/Android only;
// the real implementation lives in purchases.native.ts (Metro picks it on
// native). Keeping this stub means the web build never imports the native SDK.

export const PURCHASES_SUPPORTED = false;

export type PurchasePackage = {
  id: string;
  title: string;
  priceString: string;
  productId: string;
};

export async function configurePurchases(_appUserId?: string): Promise<void> {
  /* no-op on web */
}

export async function logoutPurchases(): Promise<void> {
  /* no-op on web */
}

export async function isPremiumActive(): Promise<boolean> {
  return false;
}

export async function getOfferingPackages(): Promise<PurchasePackage[]> {
  return [];
}

export async function purchasePackageById(_id: string, _productId?: string): Promise<boolean> {
  throw new Error('In-app purchases are only available in the mobile app.');
}

export async function restorePurchases(): Promise<boolean> {
  return false;
}
