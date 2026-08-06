import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { appApi } from '../../lib/api-client';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { colors, spacing, radius, type } from '../../lib/theme';
import { Kicker } from '../../components/AppCard';
import {
  PURCHASES_SUPPORTED,
  getOfferingPackages,
  purchasePackageById,
  restorePurchases,
  type PurchasePackage,
} from '../../lib/purchases';
import { useI18n } from '../../lib/i18n';

const TERMS_URL = 'https://www.venuewrangler.com/terms';
const PRIVACY_URL = 'https://www.venuewrangler.com/privacy';
const MONTHLY_PRICE_LABEL = '$99.99';

// Shown when RevenueCat returns no live offering yet — e.g. Expo Go / dev
// (no native key), or before the App Store subscription is approved. Keeps
// the default plan visible so the screen is never blank. Real packages from
// getOfferingPackages() override this whenever they're available.
const FALLBACK_TIERS: PurchasePackage[] = [
  {
    id: 'venueflow-monthly',
    title: 'Venue Wrangler',
    priceString: MONTHLY_PRICE_LABEL,
    productId: 'com.venuewrangler.monthly',
  },
];

export default function PaywallScreen() {
  const { t } = useI18n();
  const { me } = useAuthenticatedSession();
  const [packages, setPackages] = useState<PurchasePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Trial state is account-scoped. Anyone here is either already trialing
  // (action = upgrade to paid) or past it (action = subscribe).
  const trialEndsAt: number | null = me?.profile?.trialEndsAt ?? null;
  const inTrial = trialEndsAt != null && trialEndsAt > Date.now();
  const ctaLabel = inTrial ? t('paywall.ctaUpgrade') : t('paywall.ctaSubscribe');
  const livePackagesLoaded = packages.length > 0;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const pkgs = await getOfferingPackages();
        if (active) setPackages(pkgs);
      } catch (e) {
        console.warn('[paywall] Could not load RevenueCat offerings:', e instanceof Error ? e.message : String(e));
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
      const msg = e instanceof Error ? e.message : t('paywall.purchaseFailed');
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
        await appApi.syncAppleSubscription({ productId: 'com.venuewrangler.monthly', entitlementId: 'pro' });
        router.replace('/(tabs)/home');
      }
      else setError(t('paywall.restoreNoneFound'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('paywall.restoreFailed'));
    } finally {
      setBusy(null);
    }
  };

  const buyWithStripe = async () => {
    setBusy('stripe');
    setError(null);
    try {
      const { url } = await appApi.createStripeCheckout();
      await Linking.openURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('paywall.purchaseFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
      <View style={{ gap: 4 }}>
        <Kicker>{t('paywall.kicker')}</Kicker>
        <Text style={{ ...type.display, color: colors.charcoal }}>{t('paywall.title')}</Text>
        <Text style={{ color: colors.muted }}>{t('paywall.subtitle')}</Text>
      </View>

      {!PURCHASES_SUPPORTED ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '800', color: colors.primary }}>Venue Wrangler</Text>
            <Text style={{ color: colors.charcoal, fontSize: 24, fontWeight: '800' }}>{MONTHLY_PRICE_LABEL}<Text style={{ color: colors.muted, fontSize: 14, fontWeight: '400' }}> / month</Text></Text>
            <Text style={{ color: colors.muted }}>{t('paywall.managedInApp')}</Text>
            <Button mode="contained" buttonColor={colors.primary} loading={busy === 'stripe'} disabled={Boolean(busy)} onPress={() => void buyWithStripe()}>
              {ctaLabel}
            </Button>
          </Card.Content>
        </Card>
      ) : loading ? (
        <Text style={{ color: colors.muted }}>{t('paywall.loadingPricing')}</Text>
      ) : (
        (livePackagesLoaded ? packages : FALLBACK_TIERS).map((pkg) => {
          return (
            <Card key={pkg.id} style={{ backgroundColor: colors.surface, borderRadius: radius.soft, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
              <Card.Content style={{ gap: spacing.sm }}>
                <Text variant="titleMedium" style={{ fontWeight: '800', color: colors.primary }}>{pkg.title}</Text>
                <Text style={{ color: colors.charcoal, fontSize: 24, fontWeight: '800' }}>{MONTHLY_PRICE_LABEL}<Text style={{ color: colors.muted, fontSize: 14, fontWeight: '400' }}> / month</Text></Text>
                <Text style={{ color: colors.muted, fontWeight: '600' }}>{t('paywall.forTeamSize')}</Text>
                <Text style={{ color: colors.success, fontWeight: '600' }}>
                  {inTrial ? t('paywall.introActive') : t('paywall.monthlySubscription')}
                </Text>
                <Text style={{ color: colors.muted }}>{t('paywall.soloFreeUpgrade')}</Text>
                <Button
                  mode="contained"
                  buttonColor={colors.primary}
                  loading={busy === pkg.id}
                  disabled={!!busy || !livePackagesLoaded}
                  onPress={() => void buy(pkg.id)}
                >
                  {ctaLabel}
                </Button>
              </Card.Content>
            </Card>
          );
        })
      )}

      {!loading && PURCHASES_SUPPORTED && packages.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>
          {t('paywall.appStorePendingNotice')}
        </Text>
      ) : null}

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

      {PURCHASES_SUPPORTED ? (
        <Button mode="text" textColor={colors.primary} loading={busy === 'restore'} disabled={!!busy} onPress={() => void restore()}>
          {t('paywall.restorePurchases')}
        </Button>
      ) : null}

      <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>
        {t('paywall.autoRenewNotice')}
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.md }}>
        <Button mode="text" compact textColor={colors.muted} onPress={() => void Linking.openURL(TERMS_URL)}>{t('paywall.terms')}</Button>
        <Button mode="text" compact textColor={colors.muted} onPress={() => void Linking.openURL(PRIVACY_URL)}>{t('paywall.privacy')}</Button>
      </View>
      <Button mode="text" textColor={colors.primary} onPress={() => router.back()}>{t('paywall.back')}</Button>
    </ScrollView>
  );
}
