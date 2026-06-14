import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { appApi } from '../../lib/api-client';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { authCardStyle, authColors as colors, authInputProps as inputProps, spacing } from '../../lib/theme';

export default function VerifyEmailScreen() {
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  const user = useAuthStore((state: AuthState) => state.user);
  const setSession = useAuthStore((state: AuthState) => state.setSession);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const token = useAuthStore((state: AuthState) => state.token);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  const verify = async () => {
    if (!code.trim()) {
      Alert.alert('Verification code', 'Enter the code from your email.');
      return;
    }
    setSubmitting(true);
    try {
      await appApi.verifyEmail({ code: code.trim() });
      const redemption = typeof invite === 'string' && invite
        ? await appApi.redeemInvite(invite)
        : await appApi.redeemMyInvite();
      if (redemption.redeemed && redemption.profile) {
        setSession({
          user: {
            id: redemption.profile._id,
            email: redemption.profile.email,
            full_name: redemption.profile.fullName,
            email_verified: true,
            role: redemption.profile.role,
            job_title: redemption.profile.jobTitle,
            venue_id: redemption.profile.venueId ?? null,
            all_access: redemption.profile.allAccess === true,
          },
          venue: redemption.venue
            ? {
                id: redemption.venue._id,
                name: redemption.venue.name,
                latitude: redemption.venue.latitude,
                longitude: redemption.venue.longitude,
                geofence_radius_m: redemption.venue.geofenceRadiusM,
              }
            : null,
          token,
        });
        router.replace('/(tabs)/home');
        return;
      }
      if (user) {
        setSession({
          user: { ...user, email_verified: true },
          venue,
          token,
        });
      }
      router.replace('/(auth)/workplace-search');
    } catch (error) {
      Alert.alert('Could not verify email', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setResending(true);
    try {
      await appApi.resendVerification();
      Alert.alert('Code sent', `We sent a new verification code to ${user?.email ?? 'your email'}.`);
    } catch (error) {
      Alert.alert('Could not resend code', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
        <View style={{ gap: 6, alignItems: 'center' }}>
          <Text variant="headlineMedium" style={{ color: colors.text, fontWeight: '700', textAlign: 'center' }}>
            Verify your email
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.muted, textAlign: 'center' }}>
            Enter the 6-digit code we sent to {user?.email ?? 'your email'}.
          </Text>
        </View>

        <Card style={styles.card}>
          <Card.Content style={{ gap: spacing.md }}>
            <TextInput
              {...inputProps}
              label="Verification code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoCapitalize="none"
              mode="outlined"
              maxLength={6}
              returnKeyType="go"
              onSubmitEditing={() => void verify()}
            />

            <Button mode="contained" buttonColor={colors.primary} textColor={colors.buttonText} loading={submitting} onPress={() => void verify()}>
              Verify email
            </Button>
            <Button mode="text" textColor={colors.primary} loading={resending} onPress={() => void resend()}>
              Send a new code
            </Button>
          </Card.Content>
        </Card>

        <Button
          mode="text"
          textColor={colors.muted}
          onPress={() => {
            clearSession();
            router.replace('/(auth)/sign-in');
          }}
        >
          Sign out
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  card: {
    ...authCardStyle,
  },
});
