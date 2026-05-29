import React, { useRef, useState } from 'react';
import { Alert, Animated, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Button, Card, Chip, Menu, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { useAuthActions } from '@convex-dev/auth/react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { colors, spacing, useDesignTheme } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useI18n } from '../../lib/i18n';

type Mode = 'admin' | 'staff';

const logoSource = require('../../assets/venue-wrangler-logo.jpg');
const introVideoSource = require('../../assets/video.mp4');
const ADMIN_CONTACT_EMAIL = 'admin@venuewrangler.com';

const VENUE_TYPES = ['Restaurant', 'Bar', 'Lounge', 'Café', 'Nightclub', 'Hotel', 'Catering', 'Food truck', 'Other'];
const STAFF_RANGES = [
  { value: '1-15', label: '1–15 staff (Starter)' },
  { value: '16-30', label: '16–30 staff (Pro)' },
  { value: '31-50', label: '31–50 staff (Enterprise)' },
  { value: '50+', label: '50+ staff (contact admin)' },
];

function PickerDropdown({
  label,
  value,
  placeholder,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View>
      <Text style={{ color: colors.muted, marginBottom: 4 }}>{label}</Text>
      <Menu
        visible={open}
        onDismiss={() => setOpen(false)}
        anchor={
          <Button
            mode="outlined"
            textColor={colors.charcoal}
            onPress={() => setOpen(true)}
            contentStyle={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}
            icon={() => <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 18 }}>▾</Text>}
            style={{ borderColor: colors.border, justifyContent: 'flex-start' }}
          >
            {current?.label ?? placeholder}
          </Button>
        }
        contentStyle={{ maxHeight: 280 }}
      >
        <ScrollView style={{ maxHeight: 280 }}>
          {options.map((opt) => (
            <Menu.Item key={opt.value} title={opt.label} onPress={() => { onSelect(opt.value); setOpen(false); }} />
          ))}
        </ScrollView>
      </Menu>
    </View>
  );
}

export default function SignInScreen() {
  const { signIn, signOut } = useAuthActions();
  const bootstrapProfile = useMutation(api.app.bootstrapProfile);
  const registerVenue = useMutation(api.app.registerVenue);
  const loginWithPin = useMutation(api.staffAuth.loginWithPin);
  const redeemInvite = useMutation(api.invites.redeemInvite);
  const setSession = useAuthStore((state: AuthState) => state.setSession);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const palette = useDesignTheme();
  const { t } = useI18n();

  // Read invite token from URL params (deep link: venuewrangler://join?invite=TOKEN)
  const { invite: inviteParam } = useLocalSearchParams<{ invite?: string }>();
  const inviteToken = typeof inviteParam === 'string' ? inviteParam : undefined;

  // Look up the invite preview so we can show the venue name before sign-in
  const invitePreview = useQuery(
    api.invites.getInvitePreview,
    inviteToken ? { token: inviteToken } : 'skip',
  );

  // Default to the public "create account" path so anyone — a business or a
  // solo operator — can sign up without an invitation. The PIN path is a
  // secondary option for joining an existing team. (App Review 3.2.0: the app
  // must be openly available to the general public, not invite-only.)
  const [mode, setMode] = useState<Mode>('admin');

  // Admin (email) — default to Create account so the public sign-up is primary.
  const [flow, setFlow] = useState<'signIn' | 'signUp'>('signUp');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Owner signup — business details (creates this owner's own venue).
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [venueType, setVenueType] = useState('');
  const [staffRange, setStaffRange] = useState('');

  // Staff (PIN) — enter the business name + assigned PIN.
  const [pinBusiness, setPinBusiness] = useState('');
  const [pin, setPin] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const introOpacity = useRef(new Animated.Value(0)).current;
  const introSlide = useRef(new Animated.Value(0)).current;

  const playStaffIntro = async () => {
    setShowIntro(true);
    introOpacity.setValue(0);
    introSlide.setValue(0);
    await new Promise<void>((resolve) => {
      Animated.sequence([
        Animated.timing(introOpacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.delay(1100),
        Animated.timing(introSlide, { toValue: -420, duration: 450, useNativeDriver: true }),
      ]).start(() => resolve());
    });
  };

  const finishSession = async (options?: { staffIntro?: boolean; inviteToken?: string }) => {
    let last: { profile: any; venue: any } | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      try {
        last = await bootstrapProfile({});
        break;
      } catch (e) {
        lastError = e;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    if (!last) {
      throw lastError instanceof Error ? lastError : new Error('Sign-in did not complete. Please try again.');
    }

    // If an invite token is present and the user has no venue yet, redeem it.
    if (options?.inviteToken && !last.venue) {
      try {
        last = await redeemInvite({ token: options.inviteToken });
      } catch (e) {
        Alert.alert(
          'Invite error',
          e instanceof Error ? e.message : 'Could not redeem invite. You can join manually via the staff screen.',
        );
        // Continue sign-in without venue
      }
    }

    const { profile, venue } = last;
    setSession({
      user: { id: profile._id, email: profile.email, full_name: profile.fullName, role: profile.role, job_title: profile.jobTitle, venue_id: profile.venueId ?? null, is_demo: profile.isDemo },
      venue: venue ? { id: venue._id, name: venue.name, latitude: venue.latitude, longitude: venue.longitude, geofence_radius_m: venue.geofenceRadiusM } : null,
    });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (options?.staffIntro) await playStaffIntro();
    router.replace('/(tabs)/home');
  };

  const resetExistingSession = async () => {
    clearSession();
    try {
      await signOut();
    } catch {
      // No active session to clear — ignore.
    }
  };

  // Invite-mode: user arrived via an invite link. We skip the business-setup fields
  // and automatically redeem the invite after sign-in or sign-up.
  const onInviteSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed.includes('@') || password.trim().length < 6) {
      Alert.alert('Sign in failed', 'Enter a valid email and a password with at least 6 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await resetExistingSession();
      await signIn('password', { email: trimmed, password, flow });
      await finishSession({ inviteToken });
    } catch (e) {
      Alert.alert('Sign in failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const onAdminSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed.includes('@') || password.trim().length < 6) {
      Alert.alert('Sign in failed', 'Enter a valid email and a password with at least 6 characters.');
      return;
    }
    if (flow === 'signUp') {
      if (!businessName.trim()) {
        Alert.alert('Business name required', 'Enter your business name — your staff use it to sign in.');
        return;
      }
      if (!staffRange) {
        Alert.alert('Team size required', 'Choose how many staff you have.');
        return;
      }
      if (staffRange === '50+') {
        Alert.alert('Contact us', `For 50+ staff we set your account up manually. Please contact ${ADMIN_CONTACT_EMAIL}.`);
        return;
      }
    }
    setSubmitting(true);
    try {
      await resetExistingSession();
      await signIn('password', { email: trimmed, password, flow });
      if (flow === 'signUp') {
        await registerVenue({
          businessName: businessName.trim(),
          ownerName: fullName.trim() || undefined,
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
          venueType: venueType || undefined,
          staffRange,
        });
      }
      await finishSession();
    } catch (e) {
      Alert.alert('Sign in failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const onPinSubmit = async () => {
    if (!pinBusiness.trim()) {
      Alert.alert('Business name required', "Enter your venue's business name.");
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      Alert.alert('Enter your PIN', 'Enter your 4-digit PIN.');
      return;
    }
    setSubmitting(true);
    try {
      const { loginHandle } = await loginWithPin({ businessName: pinBusiness.trim(), pin });
      await resetExistingSession();
      await signIn('password', { email: loginHandle, password: pin, flow: 'signIn' });
      await finishSession({ staffIntro: true });
    } catch (e) {
      Alert.alert('Sign in failed', e instanceof Error ? e.message : 'Wrong PIN. Try again.');
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  // When the app is opened via an invite link, show a dedicated invite-join UI.
  if (inviteToken) {
    const isExpired = invitePreview?.expired === true;
    const isLoading = invitePreview === undefined;

    return (
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: palette.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
          <View style={{ marginBottom: spacing.sm, alignItems: 'center', gap: 10 }}>
            <Image source={logoSource} style={styles.logo} />
            <Text variant="headlineLarge" style={{ color: colors.primary, fontWeight: '800' }}>Venue Wrangler</Text>
          </View>

          <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Card.Content style={{ gap: spacing.sm }}>
              {isLoading ? (
                <Text style={{ color: colors.muted, textAlign: 'center' }}>Loading invite…</Text>
              ) : invitePreview === null ? (
                <Text style={{ color: colors.danger, textAlign: 'center' }}>This invite link is invalid.</Text>
              ) : isExpired ? (
                <Text style={{ color: colors.danger, textAlign: 'center' }}>This invite link has expired or already been used. Ask your manager for a new one.</Text>
              ) : (
                <>
                  <View style={{ alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
                    <Text variant="titleLarge" style={{ fontWeight: '700', color: colors.primary, textAlign: 'center' }}>
                      You're invited to join
                    </Text>
                    <Text variant="headlineSmall" style={{ fontWeight: '800', textAlign: 'center' }}>
                      {invitePreview.venueName}
                    </Text>
                    <Chip compact>{invitePreview.jobTitle}</Chip>
                  </View>

                  <SegmentedButtons
                    value={flow}
                    onValueChange={(v) => setFlow(v as 'signIn' | 'signUp')}
                    buttons={[{ value: 'signUp', label: 'Create account' }, { value: 'signIn', label: 'Sign in' }]}
                  />

                  {flow === 'signUp' ? (
                    <TextInput label="Your name" value={fullName} onChangeText={setFullName} mode="outlined" />
                  ) : null}
                  <TextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" mode="outlined" />
                  <TextInput label="Password" value={password} onChangeText={setPassword} secureTextEntry mode="outlined" />
                  <Button mode="contained" buttonColor={colors.primary} loading={submitting} onPress={() => void onInviteSubmit()}>
                    {flow === 'signUp' ? `Join ${invitePreview.venueName}` : 'Sign in & join'}
                  </Button>
                </>
              )}
            </Card.Content>
          </Card>

          <View style={{ alignItems: 'center', marginTop: spacing.sm }}>
            <Text style={{ color: palette.muted, fontSize: 12, fontWeight: '700' }}>{t('common.venueWrangler')}</Text>
            <Text style={{ color: palette.muted, fontSize: 11 }}>{t('common.loungeability')}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: palette.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
        <View style={{ marginBottom: spacing.sm, alignItems: 'center', gap: 10 }}>
          <Image source={logoSource} style={styles.logo} />
          <Text variant="headlineLarge" style={{ color: colors.primary, fontWeight: '800' }}>Venue Wrangler</Text>
          <Text variant="bodyMedium" style={{ color: colors.muted, marginTop: 6, textAlign: 'center' }}>Time tracking, scheduling, reservations, and team chat — for any business or solo operator. Create a free account to get started.</Text>
        </View>

        <SegmentedButtons
          value={mode}
          onValueChange={(v) => setMode(v as Mode)}
          buttons={[
            { value: 'admin', label: 'Create account / Sign in' },
            { value: 'staff', label: 'Join a team' },
          ]}
        />

        {mode === 'admin' ? (
          <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Card.Content style={{ gap: spacing.md }}>
              <SegmentedButtons
                value={flow}
                onValueChange={(v) => setFlow(v as 'signIn' | 'signUp')}
                buttons={[{ value: 'signIn', label: 'Sign in' }, { value: 'signUp', label: 'Create account' }]}
              />
              {flow === 'signUp' ? (
                <>
                  <TextInput label="Business name" value={businessName} onChangeText={setBusinessName} mode="outlined" />
                  <Text style={{ color: colors.muted, marginTop: -6, fontSize: 12 }}>Your staff receive an invite link to join your venue.</Text>
                  <TextInput label="Your name" value={fullName} onChangeText={setFullName} mode="outlined" />
                  <TextInput label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" mode="outlined" />
                  <TextInput label="Address" value={address} onChangeText={setAddress} mode="outlined" />
                  <PickerDropdown label="Venue type" value={venueType} placeholder="Select type" options={VENUE_TYPES.map((t) => ({ value: t, label: t }))} onSelect={setVenueType} />
                  <PickerDropdown label="Number of staff" value={staffRange} placeholder="Select team size" options={STAFF_RANGES} onSelect={setStaffRange} />
                  {staffRange === '50+' ? (
                    <Text style={{ color: colors.danger }}>50+ staff are set up manually — contact {ADMIN_CONTACT_EMAIL}.</Text>
                  ) : null}
                </>
              ) : null}
              <TextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" mode="outlined" />
              <TextInput label="Password" value={password} onChangeText={setPassword} secureTextEntry mode="outlined" />
              <Button mode="contained" buttonColor={colors.primary} loading={submitting} disabled={flow === 'signUp' && staffRange === '50+'} onPress={() => void onAdminSubmit()}>
                {flow === 'signUp' ? 'Create venue account' : 'Continue'}
              </Button>
            </Card.Content>
          </Card>
        ) : (
          <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Card.Content style={{ gap: spacing.md }}>
              <View style={{ gap: 6 }}>
                <Text variant="titleSmall" style={{ fontWeight: '700' }}>Joining via invite link</Text>
                <Text style={{ color: colors.muted }}>Ask your manager to send you an invite link from the Staff screen. Tap the link and you'll be joined automatically.</Text>
              </View>

              <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.sm }}>
                <Text variant="titleSmall" style={{ fontWeight: '700' }}>Or sign in with PIN</Text>
                <Text style={{ color: colors.muted }}>Enter your venue name and 4-digit PIN if your manager set one up for you.</Text>
                <TextInput label="Business name" value={pinBusiness} onChangeText={setPinBusiness} autoCapitalize="words" mode="outlined" />
                <TextInput
                  label="4-digit PIN"
                  value={pin}
                  onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 4))}
                  onSubmitEditing={() => void onPinSubmit()}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                  mode="outlined"
                />
                <Button mode="contained" buttonColor={colors.primary} loading={submitting} disabled={pin.length !== 4 || !pinBusiness.trim()} onPress={() => void onPinSubmit()}>
                  Sign in with PIN
                </Button>
              </View>
            </Card.Content>
          </Card>
        )}
        <View style={{ alignItems: 'center', marginTop: spacing.sm }}>
          <Text style={{ color: palette.muted, fontSize: 12, fontWeight: '700' }}>{t('common.venueWrangler')}</Text>
          <Text style={{ color: palette.muted, fontSize: 11 }}>{t('common.loungeability')}</Text>
        </View>
      </ScrollView>
      {showIntro ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.introOverlay, { opacity: introOpacity, transform: [{ translateX: introSlide }] }]}>
          {Platform.OS === 'web'
            ? React.createElement('video', {
                src: introVideoSource,
                autoPlay: true,
                muted: true,
                playsInline: true,
                style: webVideoStyle,
              })
            : <Image source={logoSource} style={styles.introLogo} />}
        </Animated.View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  logo: {
    width: '100%',
    maxWidth: 340,
    aspectRatio: 1024 / 559,
    resizeMode: 'contain',
  },
  introOverlay: {
    zIndex: 20,
    backgroundColor: colors.charcoal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introLogo: {
    width: '86%',
    maxWidth: 360,
    aspectRatio: 1024 / 559,
    resizeMode: 'contain',
  },
});

const webVideoStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};
