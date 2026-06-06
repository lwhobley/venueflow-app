import { Component, type ReactNode } from 'react';
import { View, ScrollView } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { router } from 'expo-router';
import { colors, spacing, radius } from '../lib/theme';

type Props = { children: ReactNode };
type State = { error: Error | null };

// App-wide error boundary. A thrown error during render (e.g. a failing
// A failed async data hook would otherwise unmount the whole tree, which is a hard
// crash in a release build. This catches it and shows a recoverable screen
// instead, so a single screen's data error never takes down the app.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary] caught:', error);
  }

  private reset = (goHome: boolean) => {
    this.setState({ error: null });
    if (goHome) {
      try {
        router.replace('/(tabs)/home');
      } catch {
        // ignore navigation errors
      }
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md }}
      >
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md }}>
          <Text variant="headlineSmall" style={{ color: colors.primary, fontWeight: '800' }}>
            Something went wrong
          </Text>
          <Text style={{ color: colors.muted }}>
            This screen hit an error and couldn’t load. Your data is safe — try again or head back home.
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={3}>
            {error.message}
          </Text>
          <Button mode="contained" buttonColor={colors.primary} onPress={() => this.reset(true)}>
            Back to Home
          </Button>
          <Button mode="text" textColor={colors.primary} onPress={() => this.reset(false)}>
            Try again
          </Button>
        </View>
      </ScrollView>
    );
  }
}
