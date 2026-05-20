// Local stub replacing the `a0-purchases` package, which dragged in
// expo-iap, a0-config, and a stale Expo SDK as transitive deps.
// Purchases now route through Convex/Stripe (see convex/billing) — this stub
// keeps the existing component contracts intact so the UI compiles.
//
// If/when you wire RevenueCat or another IAP SDK directly, swap the
// implementation inside this file rather than re-introducing a0-purchases.

import { createContext, useContext, useMemo, type ReactNode } from 'react';

export type A0PurchasePackage = {
  identifier: string;
  product: {
    identifier: string;
    priceString: string;
    title: string;
  };
};

export type A0PurchaseOfferings = {
  current: {
    identifier: string;
    availablePackages: A0PurchasePackage[];
  } | null;
};

export type A0PurchaseContextValue = {
  isPremium: boolean;
  isLoading: boolean;
  offerings: A0PurchaseOfferings | null;
  purchase: (packageId: string) => Promise<void>;
  restore: () => Promise<void>;
};

const noop = async () => {
  // No-op until a real IAP provider is wired up.
};

const defaultValue: A0PurchaseContextValue = {
  isPremium: false,
  isLoading: false,
  offerings: { current: null },
  purchase: noop,
  restore: noop,
};

const A0PurchaseContext = createContext<A0PurchaseContextValue>(defaultValue);

export type A0PurchaseProviderProps = {
  children?: ReactNode;
  config?: { appUserId?: string; debug?: boolean };
};

export function A0PurchaseProvider({ children }: A0PurchaseProviderProps) {
  const value = useMemo(() => defaultValue, []);
  return <A0PurchaseContext.Provider value={value}>{children}</A0PurchaseContext.Provider>;
}

export function useA0Purchases(): A0PurchaseContextValue {
  return useContext(A0PurchaseContext);
}
