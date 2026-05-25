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
}: {
  palette: DesignPalette;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  strong?: boolean;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: strong ? palette.surfaceStrong : palette.glass,
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: radius.lg,
          padding: spacing.lg,
          overflow: 'hidden',
          ...(Platform.OS === 'web'
            ? ({ backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)' } as ViewStyle)
            : {}),
          ...shadow,
          shadowColor: palette.shadow,
          shadowOpacity: palette.mode === 'dark' ? 0.24 : 0.12,
        },
        style,
      ]}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 18,
          right: 18,
          height: 1,
          backgroundColor: palette.primary,
          opacity: palette.mode === 'dark' ? 0.32 : 0.22,
        }}
      />
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
    hero: { color: palette.charcoal, fontSize: 28, lineHeight: 34, fontWeight: '800' },
    title: { color: palette.charcoal, fontSize: 16, lineHeight: 22, fontWeight: '800' },
    label: { color: palette.muted, fontSize: 11, lineHeight: 15, fontWeight: '700', textTransform: 'uppercase' },
    body: { color: palette.charcoal, fontSize: 14, lineHeight: 20, fontWeight: '500' },
    caption: { color: palette.muted, fontSize: 12, lineHeight: 17, fontWeight: '500' },
    metric: { color: palette.charcoal, fontSize: 26, lineHeight: 31, fontWeight: '900' },
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
          minHeight: 38,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: selected ? palette.primary : palette.border,
          backgroundColor: selected ? palette.cream : palette.surfaceSoft,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: pressed ? 0.82 : 1,
          shadowColor: palette.primary,
          shadowOpacity: selected ? 0.22 : 0,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 0 },
        },
        style,
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={16} color={selected ? palette.primary : palette.muted} /> : null}
      <Text
        numberOfLines={1}
        style={{
          color: selected ? palette.primary : palette.charcoal,
          fontSize: 12,
          fontWeight: '800',
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
        borderWidth: 1,
        borderColor: `${toneColor}55`,
        backgroundColor: `${toneColor}1F`,
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
            backgroundColor: index === values.length - 1 ? palette.primary : `${palette.primary}55`,
          }}
        />
      ))}
    </View>
  );
}
