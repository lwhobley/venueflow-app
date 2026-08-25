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
import { userFromProfile, venueFromAuth } from '../../lib/session-from-auth';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { authCardStyle, authColors as colors, authInputProps as inputProps, spacing, type } from '../../lib/theme';
import { Kicker } from '../../components/AppCard';
import { useI18n } from '../../lib/i18n';

type Stage =
  | { kind: 'entry' }
  | { kind: 'found'; invite: Extract<InviteCheckResult, { status: 'found' }> }
  | { kind: 'not_found' };

export default function InviteCheckScreen() {
  const { t } = useI18n();
  const user = useAuthStore((s: AuthState) => s.user);
  const token = useAuthStore((s: AuthState) => s.token);
  const setSession = useAuthStore((s: AuthState) => s.setSession);

  const [contact, setContact] = useState('');
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'entry' });

  const looksLikeEmail = contact.includes('@');

  const check = async () => {
    if (loading) return;
    const trimmed = contact.trim();
    if (!trimmed) {
      Alert.alert(t('inviteCheck.contactRequiredTitle'), t('inviteCheck.contactRequiredMessage'));
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
        setStage({ kind: 'not_found' });
      }
    } catch (e) {
      Alert.alert(t('inviteCheck.errorTitle'), e instanceof Error ? e.message : t('inviteCheck.genericError'));
    } finally {
      setLoading(false);
    }
  };

  const continueWithInvite = async (invite: Extract<InviteCheckResult, { status: 'found' }>) => {
    // redeemMyInvite is a one-shot mutation on the account-join path — a
    // double-tap must not fire it twice.
    if (loading) return;
    if (!looksLikeEmail) {
      Alert.alert(
        t('inviteCheck.emailOnlyTitle'),
        t('inviteCheck.emailOnlyMessage'),
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
            user: { ...userFromProfile(redemption.profile), email_verified: true },
            venue: venueFromAuth({ ...redemption.profile, emailVerified: true }, redemption.venue),
            token,
          });
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace('/(tabs)/home');
        } else {
          Alert.alert(t('inviteCheck.joinFailedTitle'), t('inviteCheck.joinFailedMessage'));
        }
      } catch (e) {
        Alert.alert(t('inviteCheck.errorTitle'), e instanceof Error ? e.message : t('inviteCheck.genericError'));
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
          <Kicker>{t('inviteCheck.kicker')}</Kicker>
          <Text style={{ ...type.title, color: colors.text }}>
            {t('inviteCheck.title')}
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.muted }}>
            {t('inviteCheck.subtitle')}
          </Text>
        </View>

        <Card style={styles.card}>
          <Card.Content style={{ gap: spacing.md }}>
            {stage.kind === 'entry' && (
              <>
                <TextInput
                  {...inputProps}
                  label={t('inviteCheck.contactLabel')}
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
                  disabled={loading}
                  onPress={() => void check()}
                >
                  {t('inviteCheck.checkButton')}
                </Button>
              </>
            )}

            {stage.kind === 'found' && (
              <View style={{ gap: spacing.sm }}>
                <Text variant="labelMedium" style={{ color: colors.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
                  {t('inviteCheck.found.label')}
                </Text>
                {stage.invite.venueName ? (
                  <Text style={{ ...type.heading, color: colors.text }}>
                    {stage.invite.venueName}
                  </Text>
                ) : null}
                {stage.invite.jobTitle ? (
                  <Text variant="bodyMedium" style={{ color: colors.muted }}>
                    {t('inviteCheck.found.role', { jobTitle: stage.invite.jobTitle })}
                  </Text>
                ) : null}
                <Text variant="bodySmall" style={{ color: colors.muted }}>
                  {!user && stage.invite.emailSent
                    ? t('inviteCheck.found.emailSentNote', { email: contact.trim() })
                    : user
                    ? t('inviteCheck.found.confirmNote')
                    : t('inviteCheck.found.signUpNote')}
                </Text>
                {user || !stage.invite.emailSent ? (
                  <Button
                    mode="contained"
                    buttonColor={colors.primary}
                    textColor={colors.buttonText}
                    loading={loading}
                    disabled={loading}
                    onPress={() => continueWithInvite(stage.invite)}
                    style={{ marginTop: 4 }}
                  >
                    {user ? t('inviteCheck.found.joinTeamButton') : t('inviteCheck.found.createAccountButton')}
                  </Button>
                ) : null}
                <Button
                  mode="text"
                  textColor={colors.muted}
                  onPress={() => {
                    setContact('');
                    setStage({ kind: 'entry' });
                  }}
                >
                  {t('inviteCheck.found.tryDifferentContact')}
                </Button>
              </View>
            )}

            {stage.kind === 'not_found' && (
              <View style={{ gap: spacing.sm }}>
                <Text variant="bodyMedium" style={{ color: colors.danger }}>
                  {t('inviteCheck.notFound.message', { contact: contact.trim() })}
                </Text>
                <Text variant="bodySmall" style={{ color: colors.muted }}>
                  {t('inviteCheck.notFound.hint')}
                </Text>
                <Button
                  mode="outlined"
                  textColor={colors.primary}
                  onPress={() => {
                    setContact('');
                    setStage({ kind: 'entry' });
                  }}
                >
                  {t('inviteCheck.notFound.tryAgain')}
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
          {t('inviteCheck.back')}
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
