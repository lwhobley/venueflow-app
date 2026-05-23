import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';

// "Cookies and cream" palette: creamy vanilla base with chocolate-cookie browns.
export const colors = {
  primary: '#5C4533', // dark cookie / chocolate
  secondary: '#A9745B', // caramel
  background: '#F5EFE3', // vanilla cream
  surface: '#FFFCF5', // creamy white
  charcoal: '#2E241C', // dark chocolate (text)
  muted: '#8C7B68', // milk-coffee gray
  border: '#E8DCC8',
  success: '#5E8C61',
  danger: '#B23A48',
  warning: '#C8893F',
  info: '#8A7B66',
  cream: '#EDE3D2',
};

// Soft cream/cookie tinted backgrounds + matching foregrounds for cards/badges.
export const accents = [
  { bg: '#F0E6D6', fg: '#6B4E37', icon: '#8B6F47' }, // cookie
  { bg: '#EFE7DB', fg: '#4A3B2E', icon: '#5C4533' }, // chocolate
  { bg: '#F3ECE0', fg: '#7A5C3E', icon: '#A9745B' }, // caramel
  { bg: '#EDE9E2', fg: '#5A5246', icon: '#8A7B66' }, // cream / neutral
  { bg: '#F6EFD9', fg: '#8A6A1E', icon: '#C8893F' }, // warm amber
  { bg: '#F0E2DD', fg: '#9A4A3C', icon: '#B23A48' }, // critical warm
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
  shadowColor: '#2E241C',
  shadowOpacity: 0.1,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 12 },
  elevation: 6,
} as const;

// Translucent "frosted glass" surface — warm cream tint. The backdrop blur is
// a web-only CSS passthrough.
export const glass = {
  backgroundColor: 'rgba(255, 252, 245, 0.74)',
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
      level2: '#F8FCFD',
    },
  },
};

export const darkTheme = {
  ...MD3DarkTheme,
  roundness: 14,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#55D7B8',
    secondary: '#17B7C8',
    background: '#061827',
    surface: '#0B2235',
    onSurface: '#F4FAFC',
    onBackground: '#F4FAFC',
    outline: '#23465A',
  },
};
