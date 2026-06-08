import { useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { appApi } from '../../lib/api-client';
import { colors, spacing, radius, shadow } from '../../lib/theme';
import {
  PURCHASES_SUPPORTED,
  getOfferingPackages,
  purchasePackageById,
  restorePurchases,
  type PurchasePackage,
} from '../../lib/purchases';

const TERMS_URL = 'https://venuewrangler.com/terms';
const PRIVACY_URL = 'https://venuewrangler.com/privacy';

// Shown when RevenueCat returns no live offering yet — e.g. Expo Go / dev
// (no native key), or before the App Store subscriptions are approved. Keeps
// the three tiers visible so the screen is never blank. Real packages from
// getOfferingPackages() override this whenever they're available.
const FALLBACK_TIERS: PurchasePackage[] = [
  { id: 'starter', title: 'Starter', priceString: '$79.99', productId: 'com.venuewrangler.starter.monthly' },
  { id: 'pro', title: 'Pro', priceString: '$149.99', productId: 'com.venuewrangler.pro.monthly' },
  { id: 'enterprise', title: 'Enterprise', priceString: '$299.99', productId: 'com.venuewrangler.enterprise.monthly' },
];

export default function PaywallScreen() {
  const [packages, setPackages] = useState<PurchasePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const pkgs = await getOfferingPackages();
        if (active) setPackages(pkgs);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not load plans.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const buy = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const selected = (packages.length ? packages : FALLBACK_TIERS).find((pkg) => pkg.id === id);
      const active = await purchasePackageById(id);
      if (active) {
        if (selected?.productId) {
          await appApi.syncAppleSubscription({ productId: selected.productId });
        }
        router.replace('/(tabs)/home');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Purchase failed.';
      // Swallow the user-cancelled case quietly.
      if (!/cancel/i.test(msg)) setError(msg);
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setBusy('restore');
    setError(null);
    try {
      const active = await restorePurchases();
      if (active) {
        await appApi.syncAppleSubscription({ productId: 'restored_apple_subscription' });
        router.replace('/(tabs)/home');
      }
      else setError('No active subscription found to restore.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Add your team</Text>
        <Text style={{ color: colors.muted }}>Venue Wrangler is free to use on your own. Subscribe to invite staff and share scheduling, the live floor, time clock, and team chat across your whole team.</Text>
      </View>

      {!PURCHASES_SUPPORTED ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.lg }}>
          <Card.Content>
            <Text style={{ color: colors.muted }}>Subscriptions are managed in the mobile app.</Text>
          </Card.Content>
        </Card>
      ) : loading ? (
        <Text style={{ color: colors.muted }}>Loading plans…</Text>
      ) : (
        (packages.length ? packages : FALLBACK_TIERS).map((pkg) => {
          const live = packages.length > 0;
          return (
            <Card key={pkg.id} style={{ backgroundColor: colors.surface, borderRadius: radius.lg, ...shadow }}>
              <Card.Content style={{ gap: spacing.sm }}>
                <Text variant="titleMedium" style={{ fontWeight: '800', color: colors.primary }}>{pkg.title}</Text>
                <Text style={{ color: colors.charcoal, fontSize: 24, fontWeight: '800' }}>{pkg.priceString}<Text style={{ color: colors.muted, fontSize: 14, fontWeight: '400' }}> / month</Text></Text>
                <Text style={{ color: colors.success, fontWeight: '600' }}>Includes 14-day free trial</Text>
                <Text style={{ color: colors.muted }}>Solo use is free. Subscribe to add team members and unlock scheduling, reservations, and team chat.</Text>
                <Button mode="contained" buttonColor={colors.primary} loading={busy === pkg.id} disabled={!!busy || !live} onPress={() => void buy(pkg.id)}>
                  Subscribe
                </Button>
              </Card.Content>
            </Card>
          );
        })
      )}

      {!loading && PURCHASES_SUPPORTED && packages.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>
          Purchasing activates in the App Store build. These plans are shown for preview.
        </Text>
      ) : null}

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

      <Button mode="text" textColor={colors.primary} loading={busy === 'restore'} disabled={!!busy || !PURCHASES_SUPPORTED} onPress={() => void restore()}>
        Restore purchases
      </Button>

      <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>
        Subscriptions auto-renew monthly until cancelled. Payment is charged to your Apple ID; manage or cancel in Settings → Apple ID → Subscriptions.
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.md }}>
        <Button mode="text" compact textColor={colors.muted} onPress={() => void Linking.openURL(TERMS_URL)}>Terms (EULA)</Button>
        <Button mode="text" compact textColor={colors.muted} onPress={() => void Linking.openURL(PRIVACY_URL)}>Privacy</Button>
      </View>
      <Button mode="text" textColor={colors.primary} onPress={() => router.back()}>Back</Button>
    </ScrollView>
  );
}
