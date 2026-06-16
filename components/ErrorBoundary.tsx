import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, ScrollView } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { router } from 'expo-router';
import { colors, spacing, radius } from '../lib/theme';

// TEMPORARY: surface the underlying error/stack on every build (including
// production) to diagnose the iOS release startup crash. Revert to a
// __DEV__-gated check once the root cause is confirmed fixed.
const EXPOSE_ERROR_DETAILS = true;

type Props = { children: ReactNode };
type State = { error: Error | null; componentStack: string | null };

// App-wide error boundary. A thrown error during render (e.g. a failing
// A failed async data hook would otherwise unmount the whole tree, which is a hard
// crash in a release build. This catches it and shows a recoverable screen
// instead, so a single screen's data error never takes down the app.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.error('[ErrorBoundary] caught:', error);
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  private reset = (goHome: boolean) => {
    this.setState({ error: null, componentStack: null });
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
          {EXPOSE_ERROR_DETAILS || (typeof __DEV__ !== 'undefined' && __DEV__) ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>
                {error.name}: {error.message}
              </Text>
              {this.state.componentStack ? (
                <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={8}>
                  {this.state.componentStack.trim()}
                </Text>
              ) : null}
            </View>
          ) : null}
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
