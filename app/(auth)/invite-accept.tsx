import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { appApi } from '../../lib/api-client';
import { authCardStyle, authColors as colors, authInputProps as inputProps, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

export default function InviteAcceptScreen() {
  const setSession = useAuthStore((s: AuthState) => s.setSession);
  const clearSession = useAuthStore((s: AuthState) => s.clearSession);

  const { token, venueName, jobTitle, phone } = useLocalSearchParams<{
    token: string;
    venueName: string;
    jobTitle: string;
    phone?: string;
  }>();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = (): string | null => {
    if (!fullName.trim()) return 'Enter your name.';
    if (!email.trim().includes('@')) return 'Enter a valid email address.';
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (password !== confirmPassword) return 'Passwords do not match.';
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    setSubmitting(true);
    try {
      clearSession();
      const resp = await appApi.passwordAuth({
        email: email.trim(),
        phone,
        password,
        flow: 'signUp',
        fullName: fullName.trim(),
        inviteToken: token,
      });
      const { profile, venue, token: authToken } = resp;
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
        token: authToken,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Route to email verification — verify-email.tsx will call redeemInvite
      // with the invite token after code confirmation to finalize team membership.
      if (!profile.emailVerified) {
        router.replace({ pathname: '/(auth)/verify-email', params: { invite: token } });
      } else {
        router.replace('/(tabs)/home');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Try again.';
      setError(msg);
      Alert.alert('Could not create account', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: spacing.lg,
          justifyContent: 'center',
          gap: spacing.md,
        }}
      >
        {/* Progress indicator */}
        <View style={styles.stepRow}>
          <View style={[styles.step, styles.stepDone]} />
          <View style={[styles.step, styles.stepActive]} />
        </View>

        <View style={{ gap: 6 }}>
          <Text variant="labelMedium" style={{ color: colors.primary, textTransform: 'uppercase', letterSpacing: 1 }}>
            You're invited to join
          </Text>
          <Text variant="headlineMedium" style={{ color: colors.text, fontWeight: '800' }}>
            {venueName}
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.muted }}>
            as {jobTitle} — create your account to accept.
          </Text>
        </View>

        <Card style={styles.card}>
          <Card.Content style={{ gap: spacing.md }}>
            {error ? (
              <Text style={{ color: colors.danger, textAlign: 'center' }}>{error}</Text>
            ) : null}

            <TextInput
              {...inputProps}
              label="Your name"
              value={fullName}
              onChangeText={setFullName}
              mode="outlined"
            />
            <TextInput
              {...inputProps}
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              mode="outlined"
            />
            <TextInput
              {...inputProps}
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              mode="outlined"
            />
            <TextInput
              {...inputProps}
              label="Confirm password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              mode="outlined"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />

            <Button
              mode="contained"
              buttonColor={colors.primary}
              textColor={colors.buttonText}
              loading={submitting}
              onPress={() => void submit()}
            >
              Accept invite &amp; create account
            </Button>

            <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>
              Already have an account?{' '}
              <Text
                style={{ color: colors.primary, fontWeight: '600' }}
                onPress={() =>
                  router.replace({
                    pathname: '/(auth)/sign-in',
                    params: { invite: token, phone },
                  })
                }
              >
                Sign in instead
              </Text>
            </Text>
          </Card.Content>
        </Card>

        <Button mode="text" textColor={colors.muted} onPress={() => router.back()}>
          Back
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  stepRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  step: { flex: 1, height: 4, borderRadius: 2, backgroundColor: '#E8E2D8' },
  stepActive: { backgroundColor: '#2F7D46' },
  stepDone: { backgroundColor: '#A8CBB0' },
  card: {
    ...authCardStyle,
  },
});
