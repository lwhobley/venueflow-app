// Compatibility wrapper replacing the old `a0-purchases` package, which
// dragged in stale Expo transitive deps. The public contract remains the same,
// but native builds now use RevenueCat through lib/purchases.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  configurePurchases,
  getOfferingPackages,
  isPremiumActive,
  purchasePackageById,
  restorePurchases,
} from './purchases';

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

const defaultValue: A0PurchaseContextValue = {
  isPremium: false,
  isLoading: true,
  offerings: { current: null },
  purchase: async () => undefined,
  restore: async () => undefined,
};

const A0PurchaseContext = createContext<A0PurchaseContextValue>(defaultValue);

export type A0PurchaseProviderProps = {
  children?: ReactNode;
  config?: { appUserId?: string; debug?: boolean };
};

function mapOfferings(packages: Awaited<ReturnType<typeof getOfferingPackages>>): A0PurchaseOfferings {
  if (packages.length === 0) return { current: null };
  return {
    current: {
      identifier: 'default',
      availablePackages: packages.map((pkg) => ({
        identifier: pkg.id,
        product: {
          identifier: pkg.productId,
          priceString: pkg.priceString,
          title: pkg.title,
        },
      })),
    },
  };
}

export function A0PurchaseProvider({ children, config }: A0PurchaseProviderProps) {
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [offerings, setOfferings] = useState<A0PurchaseOfferings | null>({ current: null });

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      await configurePurchases(config?.appUserId);
      const [active, packages] = await Promise.all([isPremiumActive(), getOfferingPackages()]);
      setIsPremium(active);
      setOfferings(mapOfferings(packages));
    } catch (e) {
      console.warn('[purchases] refresh failed:', e instanceof Error ? e.message : String(e));
      setIsPremium(false);
      setOfferings({ current: null });
    } finally {
      setIsLoading(false);
    }
  }, [config?.appUserId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const purchase = useCallback(async (packageId: string) => {
    const active = await purchasePackageById(packageId);
    setIsPremium(active);
  }, []);

  const restore = useCallback(async () => {
    const restored = await restorePurchases();
    setIsPremium(restored.active);
  }, []);

  const value = useMemo(
    () => ({ isPremium, isLoading, offerings, purchase, restore }),
    [isLoading, isPremium, offerings, purchase, restore],
  );

  return <A0PurchaseContext.Provider value={value}>{children}</A0PurchaseContext.Provider>;
}

export function useA0Purchases(): A0PurchaseContextValue {
  return useContext(A0PurchaseContext);
}
