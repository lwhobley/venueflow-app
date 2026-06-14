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
import { authCardStyle, authColors as colors, authInputProps as inputProps, spacing } from '../../lib/theme';

type Stage =
  | { kind: 'entry' }
  | { kind: 'found'; invite: Extract<InviteCheckResult, { status: 'found' }> }
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'used' };

export default function InviteCheckScreen() {
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

  const continueWithInvite = (invite: Extract<InviteCheckResult, { status: 'found' }>) => {
    router.push({
      pathname: '/(auth)/invite-accept',
      params: {
        token: invite.token,
        venueName: invite.venueName,
        jobTitle: invite.jobTitle,
        phone: looksLikeEmail ? undefined : contact.trim(),
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
          <Text variant="headlineMedium" style={{ color: colors.text, fontWeight: '700' }}>
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
                <Text variant="titleLarge" style={{ fontWeight: '800', color: colors.text }}>
                  {stage.invite.venueName}
                </Text>
                <Text variant="bodyMedium" style={{ color: colors.muted }}>
                  Role: {stage.invite.jobTitle}
                </Text>
                <Button
                  mode="contained"
                  buttonColor={colors.primary}
                  textColor={colors.buttonText}
                  onPress={() => continueWithInvite(stage.invite)}
                  style={{ marginTop: 4 }}
                >
                  Accept invite
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
                  Ask your manager to send you an invite, or join a workplace without one.
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
                <Button
                  mode="text"
                  textColor={colors.muted}
                  onPress={() => router.push('/(auth)/register')}
                >
                  Join without an invite
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
