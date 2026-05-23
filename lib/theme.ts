import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';

export const colors = {
  primary: '#6D5DF6', // vibrant indigo
  secondary: '#FF7A59', // coral accent
  background: '#F4F5FB',
  surface: '#FFFFFF',
  charcoal: '#1A1A2E',
  muted: '#6B7280',
  border: '#E6E8F0',
  success: '#16A34A',
  danger: '#E11D48',
  warning: '#F59E0B',
  info: '#0EA5E9',
  cream: '#EEF0FB',
};

// Soft tinted backgrounds + matching foregrounds for cards/badges, so the UI
// reads as colorful without sacrificing contrast.
export const accents = [
  { bg: '#EAE7FF', fg: '#5B45E0', icon: '#6D5DF6' }, // indigo
  { bg: '#FFE9E1', fg: '#D9532F', icon: '#FF7A59' }, // coral
  { bg: '#E2F6EC', fg: '#118A53', icon: '#16A34A' }, // green
  { bg: '#E1F3FE', fg: '#0B7EB5', icon: '#0EA5E9' }, // sky
  { bg: '#FFF3D6', fg: '#B5790A', icon: '#F59E0B' }, // amber
  { bg: '#FCE7F3', fg: '#BE1D62', icon: '#EC4899' }, // pink
] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

// Generous, fluid corner radii for the "liquid" look.
export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  pill: 999,
};

// Soft, diffuse shadow for floating/glassy surfaces (works on web + native).
export const shadow = {
  shadowColor: '#1A1A2E',
  shadowOpacity: 0.08,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 12 },
  elevation: 6,
} as const;

// Translucent "frosted glass" surface. On web the backdrop blur is applied via
// a passthrough CSS property (cast to any at the call site).
export const glass = {
  backgroundColor: 'rgba(255, 255, 255, 0.72)',
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.6)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
} as const;

export const lightTheme = {
  ...MD3LightTheme,
  roundness: 14,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    secondary: colors.secondary,
    background: colors.background,
    surface: colors.surface,
    onSurface: colors.charcoal,
    onBackground: colors.charcoal,
    outline: colors.border,
    elevation: {
      ...MD3LightTheme.colors.elevation,
      level1: colors.surface,
      level2: '#FBFBFE',
    },
  },
};

export const darkTheme = {
  ...MD3DarkTheme,
  roundness: 14,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#B5C7B5',
    background: '#151815',
    surface: '#1B201B',
    onSurface: '#F3EFE8',
    onBackground: '#F3EFE8',
    outline: '#3D443C',
  },
};
