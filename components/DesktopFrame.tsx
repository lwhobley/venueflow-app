import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useDesktopFrameStyle } from '../lib/responsive';

/**
 * Constrains one screen to the desktop content column and reserves the space
 * taken by the navigation rail.
 *
 * Applied centrally by ScreenErrorBoundary rather than screen by screen: the
 * app has ~40 screens with heterogeneous shells, and a per-screen rollout both
 * missed screens on the first pass and drifted afterwards — lib/responsive.ts
 * existed for months while only three files used it.
 *
 * Renders nothing extra on native or narrow web. `useDesktopFrameStyle`
 * returns null there, so a phone build gets the exact tree it had before
 * instead of an inert wrapper view around every screen.
 */
export function DesktopFrame({
  children,
  fullBleed = false,
  withNavRail = true,
}: {
  children: ReactNode;
  /**
   * Opt out for spatial surfaces — the floor plan and its editor are canvases
   * whose whole point is the available area, and squeezing them into a reading
   * column makes them worse, not more desktop-like.
   */
  fullBleed?: boolean;
  /** False for screens rendered outside the tab navigator (no rail present). */
  withNavRail?: boolean;
}) {
  const style = useDesktopFrameStyle({ withNavRail });
  if (!style || fullBleed) return <>{children}</>;
  return <View style={style}>{children}</View>;
}
