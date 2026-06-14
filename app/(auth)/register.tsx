import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Button, Card, Checkbox, Text, TextInput } from 'react-native-paper';
import { appApi } from '../../lib/api-client';
import { authCardStyle, authColors as colors, authInputProps as inputProps, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

export default function RegisterScreen() {
  const setSession = useAuthStore((s: AuthState) => s.setSession);
  const clearSession = useAuthStore((s: AuthState) => s.clearSession);
  const params = useLocalSearchParams<{ email?: string; venueName?: string; inviteFound?: string; mobile?: string }>();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [mobile, setMobile] = useState(typeof params.mobile === 'string' ? params.mobile : '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!firstName.trim()) next.firstName = 'Required';
    if (!lastName.trim()) next.lastName = 'Required';
    if (!email.trim().includes('@')) next.email = 'Enter a valid email address.';
    if (password.length < 6) next.password = 'At least 6 characters required.';
    if (password !== confirmPassword) next.confirmPassword = 'Passwords do not match.';
    if (!termsAccepted) next.terms = 'You must accept the terms to continue.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      clearSession();
      const resp = await appApi.passwordAuth({
        email: email.trim(),
        phone: mobile.trim() || undefined,
        password,
        flow: 'signUp',
        fullName: `${firstName.trim()} ${lastName.trim()}`.trim(),
      });
      const { profile, venue, token } = resp;
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
      // Go straight to workplace search — employee has no venue yet.
      router.replace(profile.emailVerified === true ? '/(auth)/workplace-search' : '/(auth)/verify-email');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Try again.';
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
          gap: spacing.md,
          paddingTop: spacing.xl,
        }}
      >
        {/* Progress */}
        <View style={styles.stepRow}>
          <View style={[styles.step, styles.stepActive]} />
          <View style={styles.step} />
        </View>

        <View style={{ gap: 4 }}>
          <Text variant="headlineMedium" style={{ color: colors.text, fontWeight: '700' }}>
            Create your account
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.muted }}>
            {params.inviteFound === '1' && params.venueName
              ? `Create your account with the invited email address, then verify it to join ${params.venueName} automatically.`
              : "You'll search for your workplace after signing up."}
          </Text>
        </View>

        <Card style={styles.card}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextInput
                  {...inputProps}
                  label="First name"
                  value={firstName}
                  onChangeText={setFirstName}
                  mode="outlined"
                  error={Boolean(errors.firstName)}
                />
                {errors.firstName ? (
                  <Text style={styles.fieldError}>{errors.firstName}</Text>
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <TextInput
                  {...inputProps}
                  label="Last name"
                  value={lastName}
                  onChangeText={setLastName}
                  mode="outlined"
                  error={Boolean(errors.lastName)}
                />
                {errors.lastName ? (
                  <Text style={styles.fieldError}>{errors.lastName}</Text>
                ) : null}
              </View>
            </View>

            <View>
              <TextInput
                {...inputProps}
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                mode="outlined"
                error={Boolean(errors.email)}
              />
              {errors.email ? (
                <Text style={styles.fieldError}>{errors.email}</Text>
              ) : null}
            </View>

            <TextInput
              {...inputProps}
              label="Mobile number (optional)"
              value={mobile}
              onChangeText={setMobile}
              keyboardType="phone-pad"
              mode="outlined"
            />

            <View>
              <TextInput
                {...inputProps}
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                mode="outlined"
                error={Boolean(errors.password)}
              />
              {errors.password ? (
                <Text style={styles.fieldError}>{errors.password}</Text>
              ) : null}
            </View>

            <View>
              <TextInput
                {...inputProps}
                label="Confirm password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                mode="outlined"
                error={Boolean(errors.confirmPassword)}
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />
              {errors.confirmPassword ? (
                <Text style={styles.fieldError}>{errors.confirmPassword}</Text>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <Checkbox
                status={termsAccepted ? 'checked' : 'unchecked'}
                onPress={() => setTermsAccepted((v) => !v)}
                color={colors.primary}
              />
              <Text variant="bodySmall" style={{ flex: 1, color: colors.muted }}>
                I agree to the{' '}
                <Text
                  style={{ color: colors.primary }}
                  onPress={() => void Linking.openURL('https://www.venuewrangler.com/terms')}
                >
                  Terms of Service
                </Text>{' '}
                and{' '}
                <Text
                  style={{ color: colors.primary }}
                  onPress={() => void Linking.openURL('https://www.venuewrangler.com/privacy')}
                >
                  Privacy Policy
                </Text>
              </Text>
            </View>
            {errors.terms ? (
              <Text style={styles.fieldError}>{errors.terms}</Text>
            ) : null}

            <Button
              mode="contained"
              buttonColor={colors.primary}
              textColor={colors.buttonText}
              loading={submitting}
              onPress={() => void submit()}
              style={{ marginTop: spacing.sm }}
            >
              Create account
            </Button>
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
  fieldError: { color: colors.danger, fontSize: 12, marginTop: 2, marginLeft: 4 },
  card: {
    ...authCardStyle,
  },
});
