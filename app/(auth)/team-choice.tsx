import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { authCardStyle, authColors as colors, spacing, type } from '../../lib/theme';
import { Kicker } from '../../components/AppCard';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

export default function TeamChoiceScreen() {
  const venue = useAuthStore((s: AuthState) => s.venue);
  const clearSession = useAuthStore((s: AuthState) => s.clearSession);

  const useDifferentAccount = () => {
    clearSession();
    router.replace('/(auth)/welcome');
  };

  if (venue) return <Redirect href="/(tabs)/home" />;

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
        <View style={{ gap: 6, alignItems: 'center' }}>
          <Kicker>Get started</Kicker>
          <Text style={{ ...type.title, color: colors.text, textAlign: 'center' }}>
            Join your team
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.muted, textAlign: 'center' }}>
            Use the invite your manager sent to your email address.
          </Text>
        </View>

        <Card style={styles.card}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700', color: colors.text }}>I have an invite</Text>
            <Text style={{ color: colors.muted }}>
              Your manager already set up the workspace. Find your invite to finish joining the team.
            </Text>
            <Button
              mode="contained"
              buttonColor={colors.primary}
              textColor={colors.buttonText}
              icon="account-group-outline"
              onPress={() => router.push('/(auth)/invite-check')}
            >
              Find my invite
            </Button>
          </Card.Content>
        </Card>

        <View style={{ alignItems: 'center', gap: 2, marginTop: spacing.sm }}>
          <Text style={{ color: colors.muted, textAlign: 'center' }}>
            Already have an account on a different login?
          </Text>
          <Button mode="text" textColor={colors.primary} onPress={useDifferentAccount}>
            Sign in to a different account
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  card: {
    ...authCardStyle,
  },
});
