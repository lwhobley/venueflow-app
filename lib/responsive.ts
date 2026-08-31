import { Platform, useWindowDimensions, type ViewStyle } from 'react-native';
import { spacing } from './theme';

export const DESKTOP_BREAKPOINT = 900;
// Keep the content column app-like instead of stretching across a wide monitor,
// so cards, inputs and buttons don't span the whole window.
export const DESKTOP_CONTENT_MAX_WIDTH = 840;

/**
 * Width of the desktop navigation rail. At desktop widths CarouselTabBar
 * renders as a persistent left sidebar instead of a bottom tab strip.
 *
 * The rail is absolutely positioned so the navigator does not need to know
 * about it, which means the screen frame must reserve this space — otherwise
 * at 900–1300px the centred column slides underneath it. DesktopFrame does
 * that reservation; see components/DesktopFrame.tsx.
 */
export const DESKTOP_NAV_WIDTH = 228;

export function useIsDesktop() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
}

/**
 * The frame style for one screen at desktop-web widths: reserve the nav rail,
 * cap the whole block at rail + column, and centre it. Centring the block
 * rather than the column alone keeps the text optically centred in the
 * remaining space while guaranteeing it never overlaps the rail at any width.
 *
 * Returns null below the breakpoint and on native, so callers can skip
 * rendering a wrapper entirely rather than inserting a no-op view into every
 * screen on mobile.
 */
export function useDesktopFrameStyle(options: { withNavRail?: boolean } = {}): ViewStyle | null {
  const isDesktop = useIsDesktop();
  if (!isDesktop) return null;
  const railInset = options.withNavRail === false ? 0 : DESKTOP_NAV_WIDTH;
  return {
    flex: 1,
    width: '100%',
    maxWidth: railInset + DESKTOP_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingLeft: railInset,
  };
}

/**
 * Desktop-web breathing room for a scroll container's contentContainerStyle.
 *
 * Deliberately does NOT set maxWidth or reserve the rail any more — the screen
 * frame owns both. When this helper also applied them, a screen inside the
 * frame was inset twice and its column ended up half the intended width.
 *
 * A no-op on native and on narrow web, so applying it cannot change how a
 * screen renders on a phone.
 */
export function useDesktopContentStyle(base: ViewStyle = {}) {
  const isDesktop = useIsDesktop();
  if (!isDesktop) return base;
  return {
    ...base,
    padding: undefined,
    paddingTop: base.paddingTop ?? base.padding ?? spacing.xl,
    paddingBottom: base.paddingBottom ?? spacing.xxl,
    paddingHorizontal: spacing.xl,
  };
}
