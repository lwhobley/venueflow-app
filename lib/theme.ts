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

export const authColors = {
  background: colors.background,
  surface: colors.surface,
  primary: colors.primary,
  text: '#1F241E',
  muted: '#6F766B',
  border: '#E8E2D8',
  danger: colors.danger,
  success: colors.success,
  buttonText: '#FFFFFF',
  highlight: '#F0F7F2',
};

export const authInputProps = {
  outlineColor: authColors.border,
  activeOutlineColor: authColors.primary,
  textColor: authColors.text,
  placeholderTextColor: authColors.muted,
  style: { backgroundColor: authColors.surface },
};

export const accents = [
  { bg: 'rgba(123, 199, 126, 0.14)', fg: '#000000', icon: '#7BC77E' },
  { bg: 'rgba(224, 168, 79, 0.16)', fg: '#000000', icon: '#E0A84F' },
  { bg: 'rgba(139, 185, 177, 0.14)', fg: '#000000', icon: '#8BB9B1' },
  { bg: 'rgba(196, 123, 86, 0.14)', fg: '#000000', icon: '#D89261' },
  { bg: 'rgba(145, 159, 125, 0.14)', fg: '#000000', icon: '#A9B78E' },
  { bg: 'rgba(224, 111, 98, 0.14)', fg: '#000000', icon: '#E06F62' },
] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
};

// Editorial system rule: at most two radii anywhere in the UI. `sharp` is for
// nearly everything (inputs, tags, buttons, most panels); `soft` is reserved
// for the handful of surfaces that read as genuine "cards" (modals, sheets,
// the rare stat tile). The old sm/md/lg/xl/pill keys are kept so the ~50
// existing call sites don't need touching, but they now all resolve to one
// of the two allowed values.
export const radius = {
  sharp: 2,
  soft: 10,
  sm: 2,
  md: 2,
  lg: 10,
  xl: 10,
  pill: 10,
};

// Typography: a serif display face (Fraunces) carries headlines and large
// numbers; everything else stays on the system sans so body text and form
// controls remain fast and native-feeling. Deliberately not Inter.
export const fontFamily = {
  display: 'Fraunces_600SemiBold',
  displayItalic: 'Fraunces_600SemiBold_Italic',
  displayMedium: 'Fraunces_500Medium',
} as const;

export const type = {
  micro: { fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
  label: { fontSize: 13, lineHeight: 18, letterSpacing: 0.4 },
  body: { fontSize: 15, lineHeight: 22, letterSpacing: 0 },
  bodyLarge: { fontSize: 17, lineHeight: 24, letterSpacing: 0 },
  heading: { fontSize: 20, lineHeight: 26, letterSpacing: -0.2, fontFamily: fontFamily.display },
  title: { fontSize: 28, lineHeight: 33, letterSpacing: -0.4, fontFamily: fontFamily.display },
  display: { fontSize: 40, lineHeight: 44, letterSpacing: -0.6, fontFamily: fontFamily.display },
} as const;

// No default drop shadow — surfaces are separated by hairline rules and
// whitespace, not elevation. Kept only for the rare truly-floating surface
// (a modal/sheet over content), used explicitly, never as a card default.
export const shadow = {
  shadowColor: designPalettes.light.shadow,
  shadowOpacity: 0.05,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 1,
} as const;

export const authCardStyle = {
  backgroundColor: authColors.surface,
  borderRadius: radius.soft,
  borderWidth: 1,
  borderColor: authColors.border,
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
    roundness: radius.sharp,
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
