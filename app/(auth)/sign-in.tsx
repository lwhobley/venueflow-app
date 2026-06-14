import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Button, Card, Chip, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { appApi } from '../../lib/api-client';
import { authCardStyle, authColors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useI18n } from '../../lib/i18n';

type InvitePreview = { expired?: boolean; venueName?: string; jobTitle?: string };

const logoSource = require('../../assets/venue-wrangler-logo.jpg');

export default function SignInScreen() {
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

  const { invite: inviteParam, phone: phoneParam, tab } = useLocalSearchParams<{ invite?: string; phone?: string; tab?: string }>();
  const inviteToken = typeof inviteParam === 'string' ? inviteParam : undefined;
  const invitePhone = typeof phoneParam === 'string' ? phoneParam : undefined;
  const [invitePreview] = useState<InvitePreview | null>(null);

  const [flow, setFlow] = useState<'signIn' | 'signUp'>(tab === 'signIn' ? 'signIn' : 'signUp');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const showError = (title: string, message: string) => {
    setFormError(message);
    Alert.alert(title, message);
  };

  const finishSession = async (options?: { inviteToken?: string }) => {
    const last = await appApi.passwordAuth({
      email: email.trim(),
      phone: invitePhone,
      password,
      flow,
      fullName: fullName.trim() || undefined,
      inviteToken: options?.inviteToken,
    });

    if (options?.inviteToken && !last.venue) {
      Alert.alert(
        'Invite pending',
        'This invite could not be applied. Ask your manager for a fresh invite or to add your email to the roster.',
      );
    }

    const { profile, venue, token } = last;
    setSession({
      user: {
        id: profile._id,
        email: profile.email,
        full_name: profile.fullName,
        email_verified: profile.emailVerified === true,
        role: profile.role,
        job_title: profile.jobTitle,
        venue_id: profile.venueId ?? null,
        all_access: profile.allAccess === true,
      },
      venue: venue
        ? {
            id: venue._id,
            name: venue.name,
            latitude: venue.latitude,
            longitude: venue.longitude,
            geofence_radius_m: venue.geofenceRadiusM,
          }
        : null,
      token,
    });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace(venue ? '/(tabs)/home' : '/(auth)/team-choice');
  };

  const resetExistingSession = () => {
    clearSession();
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
      resetExistingSession();
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

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: authColors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
        <View style={{ marginBottom: spacing.sm, alignItems: 'center', gap: 10 }}>
          <Image source={logoSource} style={styles.logo} />
          <Text variant="headlineLarge" style={{ color: authColors.primary, fontWeight: '800' }}>Venue Wrangler</Text>
          {!inviteToken ? (
            <Text variant="bodyMedium" style={{ color: authColors.muted, marginTop: 6, textAlign: 'center' }}>
              Time tracking, scheduling, reservations, and team chat. Start your 14-day free trial now, then join a venue when an owner invites you.
            </Text>
          ) : null}
        </View>

        <Card style={styles.authCard}>
          <Card.Content style={{ gap: spacing.md }}>
            {inviteBanner}
            {inviteToken ? (
              <Text style={{ color: authColors.muted, textAlign: 'center', marginBottom: spacing.sm }}>
                Create or sign in to your account and this invite will attach you to the venue.
              </Text>
            ) : null}
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
            {flow === 'signIn' ? (
              <Button mode="text" compact textColor={authColors.primary} onPress={() => router.push('/(auth)/reset-password')}>
                Forgot password?
              </Button>
            ) : null}

            <Button mode="contained" buttonColor={authColors.primary} textColor={authColors.buttonText} loading={submitting} onPress={() => void submit()}>
              {flow === 'signUp'
                ? (inviteToken && invitePreview && !invitePreview.expired ? `Join ${invitePreview.venueName}` : 'Start free trial')
                : 'Sign in'}
            </Button>

            {!inviteToken && flow === 'signUp' ? (
              <Text style={{ color: authColors.muted, fontSize: 12, textAlign: 'center' }}>
                By creating an account, you agree to our{' '}
                <Text style={{ color: authColors.primary, fontSize: 12 }} onPress={() => void Linking.openURL('https://www.venuewrangler.com/terms')}>
                  Terms of Service
                </Text>{' '}and{' '}
                <Text style={{ color: authColors.primary, fontSize: 12 }} onPress={() => void Linking.openURL('https://www.venuewrangler.com/privacy')}>
                  Privacy Policy
                </Text>. Your 14-day trial starts automatically.
              </Text>
            ) : null}
          </Card.Content>
        </Card>

        {!inviteToken ? (
          <Button
            mode="outlined"
            textColor={authColors.primary}
            onPress={() => router.push('/(auth)/invite-check')}
          >
            I have an invite from my manager
          </Button>
        ) : null}

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
    ...authCardStyle,
  },
});
