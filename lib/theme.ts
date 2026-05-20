import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';

export const colors = {
  primary: '#384C3E',
  background: '#F5F0E6',
  surface: '#FFF9F0',
  charcoal: '#1F1D1A',
  muted: '#6E665C',
  border: '#D8CDBD',
  success: '#2E6B4A',
  danger: '#A23D3D',
  cream: '#F5F0E6',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    background: colors.background,
    surface: colors.surface,
    onSurface: colors.charcoal,
    onBackground: colors.charcoal,
    outline: colors.border,
  },
};

export const darkTheme = {
  ...MD3DarkTheme,
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
