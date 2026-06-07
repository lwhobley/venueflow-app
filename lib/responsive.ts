import { Platform, useWindowDimensions, type ViewStyle } from 'react-native';
import { spacing } from './theme';

export const DESKTOP_BREAKPOINT = 900;
// Keep the content column app-like instead of stretching across a wide monitor,
// so cards, inputs and buttons don't span the whole window.
export const DESKTOP_CONTENT_MAX_WIDTH = 560;
// Dense management surfaces can opt into a wider cap for multi-column layouts.
export const DESKTOP_WIDE_CONTENT_MAX_WIDTH = 1320;

export function useIsDesktop() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
}

export function useDesktopContentStyle(base: ViewStyle = {}) {
  const isDesktop = useIsDesktop();
  return {
    ...base,
    padding: isDesktop ? spacing.xl : base.padding,
    paddingBottom: isDesktop ? spacing.xxl : base.paddingBottom,
    width: '100%' as const,
    maxWidth: isDesktop ? base.maxWidth ?? DESKTOP_CONTENT_MAX_WIDTH : base.maxWidth,
    alignSelf: 'center' as const,
  };
}
