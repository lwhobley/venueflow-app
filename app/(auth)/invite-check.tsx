import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { appApi, type InviteCheckResult } from '../../lib/api-client';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { authCardStyle, authColors as colors, authInputProps as inputProps, spacing, type } from '../../lib/theme';
import { Kicker } from '../../components/AppCard';

type Stage =
  | { kind: 'entry' }
  | { kind: 'found'; invite: Extract<InviteCheckResult, { status: 'found' }> }
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'used' };

export default function InviteCheckScreen() {
  const user = useAuthStore((s: AuthState) => s.user);
  const token = useAuthStore((s: AuthState) => s.token);
  const setSession = useAuthStore((s: AuthState) => s.setSession);

  const [contact, setContact] = useState('');
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'entry' });

  const looksLikeEmail = contact.includes('@');

  const check = async () => {
    const trimmed = contact.trim();
    if (!trimmed) {
      Alert.alert('Enter a contact', 'Type the email or mobile number your manager used to invite you.');
      return;
    }
    setLoading(true);
    try {
      const body = looksLikeEmail
        ? { email: trimmed }
        : { phone: trimmed };
      const result = await appApi.inviteCheck(body);
      if (result.status === 'found') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setStage({ kind: 'found', invite: result });
      } else {
        setStage({ kind: result.status });
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const continueWithInvite = async (invite: Extract<InviteCheckResult, { status: 'found' }>) => {
    if (!looksLikeEmail) {
      Alert.alert(
        'Use your email invite',
        'For security, team invites now attach only after email verification. Ask your manager to send the invite to your email address.',
      );
      return;
    }
    if (user) {
      if (!user.email_verified) {
        router.push('/(auth)/verify-email');
        return;
      }
      setLoading(true);
      try {
        const redemption = await appApi.redeemMyInvite();
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
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace('/(tabs)/home');
        } else {
          Alert.alert('Could not join team', 'We could not attach your profile. Ask your manager to verify your invite details.');
        }
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Something went wrong. Try again.');
      } finally {
        setLoading(false);
      }
      return;
    }
    router.push({
      pathname: '/(auth)/register',
      params: {
        email: contact.trim(),
        ...(invite.venueName ? { venueName: invite.venueName } : {}),
        inviteFound: '1',
      },
    });
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
          <View style={[styles.step, styles.stepActive]} />
          <View style={styles.step} />
        </View>

        <View style={{ gap: 6 }}>
          <Kicker>Join a team</Kicker>
          <Text style={{ ...type.title, color: colors.text }}>
            Find your invite
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.muted }}>
            Enter the email address or mobile number your manager used to invite you.
          </Text>
        </View>

        <Card style={styles.card}>
          <Card.Content style={{ gap: spacing.md }}>
            {stage.kind === 'entry' && (
              <>
                <TextInput
                  {...inputProps}
                  label="Email or mobile number"
                  value={contact}
                  onChangeText={(v) => {
                    setContact(v);
                    setStage({ kind: 'entry' });
                  }}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  mode="outlined"
                  returnKeyType="go"
                  onSubmitEditing={() => void check()}
                />
                <Button
                  mode="contained"
                  buttonColor={colors.primary}
                  textColor={colors.buttonText}
                  loading={loading}
                  onPress={() => void check()}
                >
                  Check for invite
                </Button>
              </>
            )}

            {stage.kind === 'found' && (
              <View style={{ gap: spacing.sm }}>
                <Text variant="labelMedium" style={{ color: colors.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Invite found
                </Text>
                {stage.invite.venueName ? (
                  <Text style={{ ...type.heading, color: colors.text }}>
                    {stage.invite.venueName}
                  </Text>
                ) : null}
                {stage.invite.jobTitle ? (
                  <Text variant="bodyMedium" style={{ color: colors.muted }}>
                    Role: {stage.invite.jobTitle}
                  </Text>
                ) : null}
                <Text variant="bodySmall" style={{ color: colors.muted }}>
                  {user
                    ? 'Confirm your invite to join the team automatically.'
                    : 'Sign up with this invited email address, then verify your email to join the team automatically.'}
                </Text>
                <Button
                  mode="contained"
                  buttonColor={colors.primary}
                  textColor={colors.buttonText}
                  loading={loading}
                  onPress={() => continueWithInvite(stage.invite)}
                  style={{ marginTop: 4 }}
                >
                  {user ? 'Join Team' : 'Create account'}
                </Button>
                <Button
                  mode="text"
                  textColor={colors.muted}
                  onPress={() => {
                    setContact('');
                    setStage({ kind: 'entry' });
                  }}
                >
                  Try a different contact
                </Button>
              </View>
            )}

            {stage.kind === 'not_found' && (
              <View style={{ gap: spacing.sm }}>
                <Text variant="bodyMedium" style={{ color: colors.danger }}>
                  No invite found for {contact.trim()}.
                </Text>
                <Text variant="bodySmall" style={{ color: colors.muted }}>
                  Ask your manager to send an invite to your email address.
                </Text>
                <Button
                  mode="outlined"
                  textColor={colors.primary}
                  onPress={() => {
                    setContact('');
                    setStage({ kind: 'entry' });
                  }}
                >
                  Try again
                </Button>
              </View>
            )}

            {stage.kind === 'expired' && (
              <View style={{ gap: spacing.sm }}>
                <Text variant="bodyMedium" style={{ color: colors.danger }}>
                  This invite has expired.
                </Text>
                <Text variant="bodySmall" style={{ color: colors.muted }}>
                  Ask your manager to send a fresh invite link.
                </Text>
                <Button
                  mode="outlined"
                  textColor={colors.primary}
                  onPress={() => {
                    setContact('');
                    setStage({ kind: 'entry' });
                  }}
                >
                  Try a different contact
                </Button>
              </View>
            )}

            {stage.kind === 'used' && (
              <View style={{ gap: spacing.sm }}>
                <Text variant="bodyMedium" style={{ color: colors.muted }}>
                  This invite has already been used.
                </Text>
                <Text variant="bodySmall" style={{ color: colors.muted }}>
                  If you already signed up, go back and sign in to your account.
                </Text>
                <Button
                  mode="outlined"
                  textColor={colors.primary}
                  onPress={() => router.push('/(auth)/sign-in')}
                >
                  Sign in
                </Button>
                <Button
                  mode="text"
                  textColor={colors.muted}
                  onPress={() => {
                    setContact('');
                    setStage({ kind: 'entry' });
                  }}
                >
                  Try a different contact
                </Button>
              </View>
            )}
          </Card.Content>
        </Card>

        <Button
          mode="text"
          textColor={colors.muted}
          onPress={() => router.back()}
        >
          Back
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  stepRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  step: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  stepActive: {
    backgroundColor: colors.primary,
  },
  card: {
    ...authCardStyle,
  },
});
