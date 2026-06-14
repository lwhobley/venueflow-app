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
import { spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

const colors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  primary: '#2F7D46',
  text: '#1F241E',
  muted: '#6F766B',
  border: '#E8E2D8',
  danger: '#B85047',
  buttonText: '#FFFFFF',
};

const inputProps = {
  outlineColor: colors.border,
  activeOutlineColor: colors.primary,
  textColor: colors.text,
  placeholderTextColor: colors.muted,
  style: { backgroundColor: colors.surface },
};

export default function InviteAcceptScreen() {
  const setSession = useAuthStore((s: AuthState) => s.setSession);
  const clearSession = useAuthStore((s: AuthState) => s.clearSession);

  const { token, venueName, jobTitle } = useLocalSearchParams<{
    token: string;
    venueName: string;
    jobTitle: string;
  }>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = (): string | null => {
    if (!email.trim().includes('@')) return 'Enter a valid email address.';
    if (password.length < 6) return 'Password must be at least 6 characters.';
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
        password,
        flow: 'signUp',
        inviteToken: token,
      });
      const { profile, venue, token: authToken } = resp;
      setSession({
        user: {
          id: profile._id,
          email: profile.email,
          full_name: profile.fullName,
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
      router.replace('/(tabs)/home');
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
                    params: { invite: token },
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
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8E2D8',
    shadowColor: '#817B6B',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
});
