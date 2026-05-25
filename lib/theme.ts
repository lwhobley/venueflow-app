import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import { create } from 'zustand';

type ThemeMode = 'dark' | 'light';

type AppearanceState = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
};

export const useAppearanceStore = create<AppearanceState>((set) => ({
  mode: 'dark',
  setMode: (mode) => set({ mode }),
  toggleMode: () => set((state) => ({ mode: state.mode === 'dark' ? 'light' : 'dark' })),
}));

export const designPalettes = {
  dark: {
    mode: 'dark' as const,
    background: '#071015',
    backgroundAlt: '#0B151C',
    surface: 'rgba(15, 28, 36, 0.88)',
    surfaceStrong: '#101E27',
    surfaceSoft: 'rgba(20, 37, 47, 0.66)',
    glass: 'rgba(17, 31, 40, 0.72)',
    primary: '#55F0DE',
    secondary: '#7B8CFF',
    charcoal: '#F2FAF9',
    muted: '#9DB3B8',
    border: 'rgba(122, 245, 232, 0.18)',
    divider: 'rgba(218, 250, 247, 0.09)',
    success: '#61F2A1',
    danger: '#FF6B7A',
    warning: '#F8C76A',
    info: '#6BE5FF',
    cream: 'rgba(85, 240, 222, 0.12)',
    glow: 'rgba(85, 240, 222, 0.34)',
    shadow: '#000000',
  },
  light: {
    mode: 'light' as const,
    background: '#EEF1F0',
    backgroundAlt: '#F7F8F5',
    surface: 'rgba(255, 255, 251, 0.86)',
    surfaceStrong: '#FFFFFF',
    surfaceSoft: 'rgba(238, 244, 242, 0.84)',
    glass: 'rgba(255, 255, 255, 0.72)',
    primary: '#048E95',
    secondary: '#4F5BE8',
    charcoal: '#132229',
    muted: '#63747A',
    border: 'rgba(4, 142, 149, 0.18)',
    divider: 'rgba(19, 34, 41, 0.09)',
    success: '#128957',
    danger: '#B83A4A',
    warning: '#A96D12',
    info: '#067EAA',
    cream: 'rgba(4, 142, 149, 0.1)',
    glow: 'rgba(4, 142, 149, 0.22)',
    shadow: '#6C7A80',
  },
} as const;

export type DesignPalette = (typeof designPalettes)[ThemeMode];

export const useDesignTheme = () => {
  const mode = useAppearanceStore((state) => state.mode);
  return designPalettes[mode];
};

export const colors = designPalettes.dark;

export const accents = [
  { bg: 'rgba(85, 240, 222, 0.14)', fg: '#55F0DE', icon: '#55F0DE' },
  { bg: 'rgba(248, 199, 106, 0.16)', fg: '#F8C76A', icon: '#F8C76A' },
  { bg: 'rgba(97, 242, 161, 0.14)', fg: '#61F2A1', icon: '#61F2A1' },
  { bg: 'rgba(123, 140, 255, 0.14)', fg: '#B7C0FF', icon: '#7B8CFF' },
  { bg: 'rgba(107, 229, 255, 0.14)', fg: '#6BE5FF', icon: '#6BE5FF' },
  { bg: 'rgba(255, 107, 122, 0.14)', fg: '#FF8C98', icon: '#FF6B7A' },
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
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};

export const shadow = {
  shadowColor: designPalettes.dark.shadow,
  shadowOpacity: 0.24,
  shadowRadius: 28,
  shadowOffset: { width: 0, height: 18 },
  elevation: 8,
} as const;

export const glass = {
  backgroundColor: designPalettes.dark.glass,
  borderWidth: 1,
  borderColor: designPalettes.dark.border,
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
