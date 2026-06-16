import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { authCardStyle, authColors as colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

export default function TeamChoiceScreen() {
  const venue = useAuthStore((s: AuthState) => s.venue);

  // Once a venue exists (created or joined), leave onboarding. <Redirect> is
  // render-safe, so it never throws "navigate before mounting the Root Layout"
  // even when this screen is the initial/restored route.
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
          <Text variant="headlineMedium" style={{ color: colors.text, fontWeight: '700', textAlign: 'center' }}>
            How do you want to get started?
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.muted, textAlign: 'center' }}>
            Create a new team for your venue, or join an existing one.
          </Text>
        </View>

        <Card style={styles.card}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700', color: colors.text }}>I'm an owner or manager</Text>
            <Text style={{ color: colors.muted }}>
              Set up your venue and start managing your team right away.
            </Text>
            <Button
              mode="contained"
              buttonColor={colors.primary}
              textColor={colors.buttonText}
              icon="plus-circle-outline"
              onPress={() => router.push('/(auth)/create-venue')}
            >
              Create a team
            </Button>
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700', color: colors.text }}>I'm joining a team</Text>
            <Text style={{ color: colors.muted }}>
              Your manager already set things up — find your venue or use an invite.
            </Text>
            <Button
              mode="contained"
              buttonColor={colors.primary}
              textColor={colors.buttonText}
              icon="account-group-outline"
              onPress={() => router.push('/(auth)/invite-check')}
            >
              I have an invite
            </Button>
            <Button
              mode="outlined"
              textColor={colors.primary}
              onPress={() => router.push('/(auth)/workplace-search')}
            >
              Search for my workplace
            </Button>
          </Card.Content>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  card: {
    ...authCardStyle,
  },
});
