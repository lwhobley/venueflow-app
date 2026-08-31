import { Stack } from 'expo-router';
import { DesktopFrame } from '../../components/DesktopFrame';
import { colors } from '../../lib/theme';

/**
 * Group layout for the unauthenticated stack.
 *
 * Its only job is the desktop content column. The tab screens get that from
 * ScreenErrorBoundary, but no auth screen uses the boundary, so on a wide
 * monitor sign-in and welcome stretched their buttons across the whole window
 * — the first thing anyone sees on desktop.
 *
 * withNavRail={false}: these screens render before the tab navigator exists,
 * so there is no rail to reserve space for.
 */
export default function AuthLayout() {
  return (
    <DesktopFrame withNavRail={false}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </DesktopFrame>
  );
}
