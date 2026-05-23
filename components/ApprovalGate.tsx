import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { useQuery } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { api } from '../convex/_generated/api';
import { colors, spacing, radius, shadow } from '../lib/theme';
import { useAuthStore, type AuthState } from '../lib/auth-store';

// Blocks a freshly-signed-up venue until the site creator approves it.
export function ApprovalGate({ children }: { children: ReactNode }) {
  const approval = useQuery(api.app.getMyVenueApprovalStatus, {});
  const { signOut } = useAuthActions();
  const clearSession = useAuthStore((s: AuthState) => s.clearSession);

  // Not signed in (null) or approved -> render the app. While loading
  // (undefined) we also render through so sign-in isn't blocked.
  if (!approval || approval.status === 'approved') return <>{children}</>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.lg }}>
      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.lg, maxWidth: 460, width: '100%', ...shadow }}>
        <Card.Content style={{ gap: spacing.md, alignItems: 'center' }}>
          <Text variant="headlineSmall" style={{ color: colors.primary, fontWeight: '800', textAlign: 'center' }}>
            Pending approval
          </Text>
          <Text style={{ color: colors.charcoal, textAlign: 'center' }}>
            Your venue <Text style={{ fontWeight: '800' }}>{approval.venueName}</Text> has been created and is awaiting approval from the VenueFlow team.
          </Text>
          <Text style={{ color: colors.muted, textAlign: 'center' }}>
            You'll be able to sign in and set up your venue as soon as it's approved. This usually takes a short while.
          </Text>
          <Button
            mode="outlined"
            textColor={colors.primary}
            onPress={() => {
              clearSession();
              void signOut();
            }}
          >
            Sign out
          </Button>
        </Card.Content>
      </Card>
    </View>
  );
}
