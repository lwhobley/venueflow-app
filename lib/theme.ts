import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import { create } from 'zustand';

type ThemeMode = 'dark' | 'light';

type AppearanceState = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
};

export const useAppearanceStore = create<AppearanceState>((set) => ({
  mode: 'light',
  setMode: (mode) => set({ mode }),
  toggleMode: () => set((state) => ({ mode: state.mode === 'dark' ? 'light' : 'dark' })),
}));

export const designPalettes = {
  dark: {
    mode: 'dark' as const,
    background: '#111513',
    backgroundAlt: '#171C19',
    surface: 'rgba(29, 35, 31, 0.94)',
    surfaceStrong: '#202720',
    surfaceSoft: 'rgba(42, 49, 43, 0.72)',
    glass: 'rgba(30, 37, 32, 0.9)',
    primary: '#7BC77E',
    secondary: '#E0A84F',
    charcoal: '#F4F1E9',
    muted: '#A9A79C',
    border: 'rgba(244, 241, 233, 0.1)',
    divider: 'rgba(244, 241, 233, 0.08)',
    success: '#80C982',
    danger: '#E06F62',
    warning: '#D6A84C',
    info: '#8BB9B1',
    cream: 'rgba(123, 199, 126, 0.14)',
    glow: 'rgba(123, 199, 126, 0.12)',
    shadow: '#000000',
  },
  light: {
    mode: 'light' as const,
    background: '#FFFFFF',
    backgroundAlt: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceStrong: '#FFFFFF',
    surfaceSoft: '#F7F8F5',
    glass: '#FFFFFF',
    primary: '#2F7D46',
    secondary: '#B7752A',
    charcoal: '#23241F',
    muted: '#6F6A5F',
    border: 'rgba(35, 36, 31, 0.1)',
    divider: 'rgba(35, 36, 31, 0.08)',
    success: '#2F7D46',
    danger: '#B85047',
    warning: '#986A22',
    info: '#497A78',
    cream: 'rgba(47, 125, 70, 0.1)',
    glow: 'rgba(47, 125, 70, 0.1)',
    shadow: '#817B6B',
  },
} as const;

export type DesignPalette = (typeof designPalettes)[ThemeMode];

export const useDesignTheme = () => {
  const mode = useAppearanceStore((state) => state.mode);
  return designPalettes[mode];
};

export const colors = designPalettes.light;

export const accents = [
  { bg: 'rgba(123, 199, 126, 0.14)', fg: '#7BC77E', icon: '#7BC77E' },
  { bg: 'rgba(224, 168, 79, 0.16)', fg: '#E0A84F', icon: '#E0A84F' },
  { bg: 'rgba(139, 185, 177, 0.14)', fg: '#8BB9B1', icon: '#8BB9B1' },
  { bg: 'rgba(196, 123, 86, 0.14)', fg: '#D89261', icon: '#D89261' },
  { bg: 'rgba(145, 159, 125, 0.14)', fg: '#A9B78E', icon: '#A9B78E' },
  { bg: 'rgba(224, 111, 98, 0.14)', fg: '#E06F62', icon: '#E06F62' },
] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  pill: 999,
};

export const shadow = {
  shadowColor: designPalettes.light.shadow,
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 2,
} as const;

export const glass = {
  backgroundColor: designPalettes.light.glass,
  borderWidth: 1,
  borderColor: designPalettes.light.border,
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
} as const;

export const makePaperTheme = (mode: ThemeMode) => {
  const palette = designPalettes[mode];
  const base = mode === 'dark' ? MD3DarkTheme : MD3LightTheme;

  return {
    ...base,
    dark: mode === 'dark',
    roundness: 10,
    colors: {
      ...base.colors,
      primary: palette.primary,
      secondary: palette.secondary,
      background: palette.background,
      surface: palette.surfaceStrong,
      onSurface: palette.charcoal,
      onBackground: palette.charcoal,
      outline: palette.border,
      error: palette.danger,
      elevation: {
        ...base.colors.elevation,
        level1: palette.surface,
        level2: palette.surfaceSoft,
      },
    },
  };
};

export const lightTheme = makePaperTheme('light');
export const darkTheme = makePaperTheme('dark');
