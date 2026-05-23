import React, { useRef, useState } from 'react';
import { Alert, Animated, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Button, Card, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { useAuthActions } from '@convex-dev/auth/react';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

type Mode = 'admin' | 'staff';

const logoSource = require('../../assets/venue-wrangler-logo.jpg');
const introVideoSource = require('../../assets/video.mp4');

export default function SignInScreen() {
  const { signIn, signOut } = useAuthActions();
  const bootstrapProfile = useMutation(api.app.bootstrapProfile);
  const loginWithPin = useMutation(api.staffAuth.loginWithPin);
  const setSession = useAuthStore((state: AuthState) => state.setSession);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);

  const [mode, setMode] = useState<Mode>('staff');

  // Admin (email)
  const [flow, setFlow] = useState<'signIn' | 'signUp'>('signIn');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Staff (PIN) — no name selection; the staffer just enters their assigned PIN.
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

  // After signIn() resolves, the Convex client may briefly still be settling the
  // new auth token, so bootstrapProfile can throw "Unauthenticated" for a moment.
  // We retry until it succeeds. We deliberately do NOT match on email: the stored
  // profile email can differ from the typed login (e.g. PIN handles, or an admin
  // whose token carried no email and fell back to a placeholder). The wrong-account
  // risk is already handled by resetExistingSession() signing out first, so the
  // first successful bootstrap belongs to the account we just signed in as.
  const finishSession = async (options?: { staffIntro?: boolean }) => {
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
    const { profile, venue } = last;
    setSession({
      user: { id: profile._id, email: profile.email, full_name: profile.fullName, role: profile.role, job_title: profile.jobTitle, venue_id: profile.venueId ?? null },
      venue: venue ? { id: venue._id, name: venue.name, latitude: venue.latitude, longitude: venue.longitude, geofence_radius_m: venue.geofenceRadiusM } : null,
    });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (options?.staffIntro) await playStaffIntro();
    router.replace('/(tabs)/home');
  };

  // Drop any existing session (Convex Auth token + persisted store) before
  // starting a new sign-in so a previous account can't leak through.
  const resetExistingSession = async () => {
    clearSession();
    try {
      await signOut();
    } catch {
      // No active session to clear — ignore.
    }
  };

  const onAdminSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed.includes('@') || password.trim().length < 6) {
      Alert.alert('Sign in failed', 'Enter a valid email and a password with at least 6 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await resetExistingSession();
      await signIn('password', { email: trimmed, password, flow });
      await finishSession();
    } catch (e) {
      Alert.alert('Sign in failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const onPinSubmit = async () => {
    if (!/^\d{4}$/.test(pin)) {
      Alert.alert('Enter your PIN', 'Enter your 4-digit PIN.');
      return;
    }
    setSubmitting(true);
    try {
      const { loginHandle } = await loginWithPin({ pin });
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

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
        <View style={{ marginBottom: spacing.sm, alignItems: 'center', gap: 10 }}>
          <Image source={logoSource} style={styles.logo} />
          <Text variant="headlineLarge" style={{ color: colors.primary, fontWeight: '800' }}>Venue Wrangler</Text>
          <Text variant="bodyMedium" style={{ color: colors.muted, marginTop: 6 }}>Premium venue ops for clock-in, shifts, and floor control.</Text>
        </View>

        <SegmentedButtons
          value={mode}
          onValueChange={(v) => setMode(v as Mode)}
          buttons={[
            { value: 'staff', label: 'Staff PIN' },
            { value: 'admin', label: 'Owner email' },
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
              {flow === 'signUp' ? <TextInput label="Full name" value={fullName} onChangeText={setFullName} mode="outlined" /> : null}
              <TextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" mode="outlined" />
              <TextInput label="Password" value={password} onChangeText={setPassword} secureTextEntry mode="outlined" />
              <Button mode="contained" buttonColor={colors.primary} loading={submitting} onPress={() => void onAdminSubmit()}>
                {flow === 'signUp' ? 'Create account' : 'Continue'}
              </Button>
            </Card.Content>
          </Card>
        ) : (
          <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Card.Content style={{ gap: spacing.md }}>
              <Text style={{ color: colors.muted }}>Enter the 4-digit PIN your manager assigned you.</Text>
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
              <Button mode="contained" buttonColor={colors.primary} loading={submitting} disabled={pin.length !== 4} onPress={() => void onPinSubmit()}>
                Sign in
              </Button>
            </Card.Content>
          </Card>
        )}
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
