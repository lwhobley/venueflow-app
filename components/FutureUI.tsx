import { ReactNode } from 'react';
import { Platform, Pressable, StyleProp, Text, TextStyle, View, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DesignPalette, radius, shadow, spacing } from '../lib/theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
type CommandTextVariant = 'hero' | 'title' | 'label' | 'body' | 'caption' | 'metric';

export function CommandSurface({
  palette,
  children,
  style,
  strong,
  inset,
}: {
  palette: DesignPalette;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  strong?: boolean;
  inset?: boolean;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: strong ? palette.surfaceStrong : inset ? palette.surfaceSoft : palette.surface,
          borderWidth: strong ? 1 : 0,
          borderColor: strong ? palette.border : 'transparent',
          borderRadius: radius.lg,
          padding: inset ? spacing.md : spacing.lg,
          overflow: 'hidden',
          ...(Platform.OS === 'web'
            ? ({ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' } as ViewStyle)
            : {}),
          shadowColor: palette.shadow,
          shadowOpacity: strong ? (palette.mode === 'dark' ? 0.18 : 0.08) : 0.06,
          shadowRadius: strong ? 22 : 12,
          shadowOffset: { width: 0, height: strong ? 12 : 5 },
          elevation: strong ? shadow.elevation : 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function CommandText({
  palette,
  children,
  variant = 'body',
  style,
}: {
  palette: DesignPalette;
  children: ReactNode;
  variant?: CommandTextVariant;
  style?: StyleProp<TextStyle>;
}) {
  const styles: Record<CommandTextVariant, TextStyle> = {
    hero: { color: palette.charcoal, fontSize: 30, lineHeight: 36, fontWeight: '700' },
    title: { color: palette.charcoal, fontSize: 17, lineHeight: 23, fontWeight: '700' },
    label: { color: palette.muted, fontSize: 11, lineHeight: 15, fontWeight: '700', textTransform: 'uppercase' },
    body: { color: palette.charcoal, fontSize: 14, lineHeight: 20, fontWeight: '500' },
    caption: { color: palette.muted, fontSize: 12, lineHeight: 17, fontWeight: '500' },
    metric: { color: palette.charcoal, fontSize: 27, lineHeight: 32, fontWeight: '700' },
  };

  return <Text style={[styles[variant], { letterSpacing: 0 }, style]}>{children}</Text>;
}

export function CommandButton({
  palette,
  children,
  icon,
  selected,
  onPress,
  style,
  accessibilityLabel,
}: {
  palette: DesignPalette;
  children: ReactNode;
  icon?: IconName;
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected ? { selected: true } : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 34,
          paddingHorizontal: 11,
          paddingVertical: 7,
          borderRadius: radius.pill,
          borderWidth: 0,
          backgroundColor: selected ? palette.primary : palette.surfaceSoft,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: pressed ? 0.82 : 1,
        },
        style,
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={16} color={selected ? palette.backgroundAlt : palette.muted} /> : null}
      <Text
        numberOfLines={1}
        style={{
          color: selected ? palette.backgroundAlt : palette.charcoal,
          fontSize: 12,
          fontWeight: '700',
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}

export function StatusPill({
  palette,
  children,
  tone = 'neutral',
}: {
  palette: DesignPalette;
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'danger';
}) {
  const toneColor = tone === 'good' ? palette.success : tone === 'warn' ? palette.warning : tone === 'danger' ? palette.danger : palette.primary;
  return (
    <View
      style={{
        borderRadius: radius.pill,
        borderWidth: 0,
        backgroundColor: `${toneColor}24`,
        paddingHorizontal: 10,
        paddingVertical: 5,
        alignSelf: 'flex-start',
      }}
    >
      <Text numberOfLines={1} style={{ color: toneColor, fontSize: 11, fontWeight: '800' }}>
        {children}
      </Text>
    </View>
  );
}

export function MiniTrend({ palette, values }: { palette: DesignPalette; values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 34 }}>
      {values.map((value, index) => (
        <View
          key={`${value}-${index}`}
          style={{
            width: 5,
            height: Math.max(6, (value / max) * 34),
            borderRadius: 999,
            backgroundColor: index === values.length - 1 ? palette.primary : `${palette.primary}44`,
          }}
        />
      ))}
    </View>
  );
}
