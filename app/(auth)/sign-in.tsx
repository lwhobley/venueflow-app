import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Button, Card, Chip, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { useAuthActions } from '@convex-dev/auth/react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useI18n } from '../../lib/i18n';

type SessionPayload = { profile: any; venue: any | null };

const logoSource = require('../../assets/venue-wrangler-logo.jpg');
const authColors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  primary: '#2F7D46',
  text: '#1F241E',
  muted: '#6F766B',
  border: '#E8E2D8',
  danger: '#B85047',
  buttonText: '#FFFFFF',
};

export default function SignInScreen() {
  const { signIn, signOut } = useAuthActions();
  const bootstrapProfile = useMutation(api.app.bootstrapProfile);
  const redeemInvite = useMutation(api.invites.redeemInvite);
  const setSession = useAuthStore((state: AuthState) => state.setSession);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const { t } = useI18n();

  const authInputProps = {
    outlineColor: authColors.border,
    activeOutlineColor: authColors.primary,
    textColor: authColors.text,
    placeholderTextColor: authColors.muted,
    style: { backgroundColor: authColors.surface },
  };
  const authControlTheme = {
    colors: {
      primary: authColors.primary,
      secondaryContainer: '#E5F1E7',
      onSecondaryContainer: authColors.text,
      onSurface: authColors.text,
      outline: authColors.border,
    },
  };

  // Read invite token from URL params (deep link: venuewrangler://join?invite=TOKEN).
  const { invite: inviteParam } = useLocalSearchParams<{ invite?: string }>();
  const inviteToken = typeof inviteParam === 'string' ? inviteParam : undefined;
  const invitePreview = useQuery(
    api.invites.getInvitePreview,
    inviteToken ? { token: inviteToken } : 'skip',
  );

  const [flow, setFlow] = useState<'signIn' | 'signUp'>('signUp');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Inline error surface. On React Native Web, Alert.alert is a no-op, so an
  // alert-only failure path looks like "nothing happened". Mirror errors here.
  const [formError, setFormError] = useState<string | null>(null);

  const showError = (title: string, message: string) => {
    setFormError(message);
    Alert.alert(title, message);
  };

  const finishSession = async (options?: { inviteToken?: string }) => {
    let last: SessionPayload | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      try {
        last = await bootstrapProfile({ fullName: fullName.trim() || undefined });
        break;
      } catch (e) {
        lastError = e;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    if (!last) {
      throw lastError instanceof Error ? lastError : new Error('Sign-in did not complete. Please try again.');
    }

    // If the user arrived via an invite link and has no venue yet, redeem it.
    if (options?.inviteToken && !last.venue) {
      try {
        last = await redeemInvite({ token: options.inviteToken });
      } catch (e) {
        Alert.alert(
          'Invite error',
          e instanceof Error ? e.message : 'Could not redeem invite. Ask your manager to add you to the team.',
        );
      }
    }

    const { profile, venue } = last;
    setSession({
      user: { id: profile._id, email: profile.email, full_name: profile.fullName, role: profile.role, job_title: profile.jobTitle, venue_id: profile.venueId ?? null },
      venue: venue ? { id: venue._id, name: venue.name, latitude: venue.latitude, longitude: venue.longitude, geofence_radius_m: venue.geofenceRadiusM } : null,
    });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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

  const submit = async () => {
    const trimmed = email.trim();
    if (!trimmed.includes('@') || password.trim().length < 6) {
      Alert.alert('Check your details', 'Enter a valid email and a password with at least 6 characters.');
      return;
    }
    if (flow === 'signUp' && !fullName.trim()) {
      Alert.alert('Your name', 'Enter your name so your team can recognize you.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await resetExistingSession();
      await signIn('password', { email: trimmed, password, flow });
      await finishSession({ inviteToken });
    } catch (e) {
      showError(flow === 'signUp' ? 'Could not create account' : 'Sign in failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inviteBanner = inviteToken && invitePreview && !invitePreview.expired ? (
    <View style={{ alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
      <Text variant="titleMedium" style={{ fontWeight: '700', color: authColors.primary, textAlign: 'center' }}>
        You're invited to join
      </Text>
      <Text variant="titleLarge" style={{ fontWeight: '800', textAlign: 'center', color: authColors.text }}>
        {invitePreview.venueName}
      </Text>
      <Chip compact>{invitePreview.jobTitle}</Chip>
    </View>
  ) : null;

  const inviteError = inviteToken && (invitePreview === null || invitePreview?.expired) ? (
    <Text style={{ color: authColors.danger, textAlign: 'center', marginBottom: spacing.sm }}>
      {invitePreview === null
        ? 'This invite link is invalid.'
        : 'This invite link has expired or was already used. Ask your manager to add your email to the team.'}
    </Text>
  ) : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: authColors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
        <View style={{ marginBottom: spacing.sm, alignItems: 'center', gap: 10 }}>
          <Image source={logoSource} style={styles.logo} />
          <Text variant="headlineLarge" style={{ color: authColors.primary, fontWeight: '800' }}>Venue Wrangler</Text>
          {!inviteToken ? (
            <Text variant="bodyMedium" style={{ color: authColors.muted, marginTop: 6, textAlign: 'center' }}>
              Time tracking, scheduling, reservations, and team chat. Create a free account to get started — your 14-day trial begins right away.
            </Text>
          ) : null}
        </View>

        <Card style={styles.authCard}>
          <Card.Content style={{ gap: spacing.md }}>
            {inviteBanner}
            {inviteError}
            {formError ? (
              <Text style={{ color: authColors.danger, textAlign: 'center' }}>{formError}</Text>
            ) : null}

            <SegmentedButtons
              theme={authControlTheme}
              value={flow}
              onValueChange={(v) => setFlow(v as 'signIn' | 'signUp')}
              buttons={[{ value: 'signUp', label: 'Create account' }, { value: 'signIn', label: 'Sign in' }]}
            />

            {flow === 'signUp' ? (
              <TextInput {...authInputProps} label="Your name" value={fullName} onChangeText={setFullName} mode="outlined" />
            ) : null}
            <TextInput {...authInputProps} label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" mode="outlined" />
            <TextInput {...authInputProps} label="Password" value={password} onChangeText={setPassword} secureTextEntry mode="outlined" />

            <Button mode="contained" buttonColor={authColors.primary} textColor={authColors.buttonText} loading={submitting} onPress={() => void submit()}>
              {flow === 'signUp'
                ? (inviteToken && invitePreview && !invitePreview.expired ? `Join ${invitePreview.venueName}` : 'Create free account')
                : 'Sign in'}
            </Button>

            {!inviteToken ? (
              <Text style={{ color: authColors.muted, fontSize: 12, textAlign: 'center' }}>
                You don't need a venue to sign up. An admin or manager adds your email to their team to give you access.
              </Text>
            ) : null}
          </Card.Content>
        </Card>

        <View style={{ alignItems: 'center', marginTop: spacing.sm }}>
          <Text style={{ color: authColors.muted, fontSize: 12, fontWeight: '700' }}>{t('common.venueWrangler')}</Text>
          <Text style={{ color: authColors.muted, fontSize: 11 }}>{t('common.loungeability')}</Text>
        </View>
      </ScrollView>
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
  authCard: {
    backgroundColor: authColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: authColors.border,
    shadowColor: '#817B6B',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
});
