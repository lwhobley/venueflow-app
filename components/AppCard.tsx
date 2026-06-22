import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleProp,
  UIManager,
  View,
  ViewStyle,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, useDesignTheme } from '../lib/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type CardTone = 'default' | 'soft' | 'inset';

export function AppCard({
  children,
  tone = 'default',
  style,
  padded = true,
}: {
  children: ReactNode;
  tone?: CardTone;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const palette = useDesignTheme();
  const background =
    tone === 'inset' ? palette.surfaceSoft : tone === 'soft' ? palette.cream : palette.surface;
  return (
    <View
      style={[
        {
          backgroundColor: background,
          borderRadius: radius.xl,
          borderWidth: tone === 'default' ? 1 : 0,
          borderColor: palette.border,
          padding: padded ? spacing.lg : 0,
          shadowColor: palette.shadow,
          shadowOpacity: tone === 'default' ? 0.05 : 0,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: tone === 'default' ? 1 : 0,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
  rightAdornment,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  rightAdornment?: ReactNode;
}) {
  const palette = useDesignTheme();
  const [open, setOpen] = useState(defaultOpen);
  const rotate = useRef(new Animated.Value(defaultOpen ? 1 : 0)).current;

  const toggle = () => {
    LayoutAnimation.configureNext({
      duration: 220,
      create: { type: 'easeInEaseOut', property: 'opacity' },
      update: { type: 'easeInEaseOut' },
      delete: { type: 'easeInEaseOut', property: 'opacity' },
    });
    Animated.timing(rotate, {
      toValue: open ? 0 : 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    setOpen((v) => !v);
  };

  const chevronRotate = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <AppCard padded={false}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${open ? 'Collapse' : 'Expand'} ${title}`}
        style={({ pressed }) => ({
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium" style={{ fontWeight: '700', color: palette.charcoal }}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ color: palette.muted, fontSize: 12, marginTop: 2 }}>{subtitle}</Text>
          ) : null}
        </View>
        {rightAdornment}
        <Animated.View style={{ transform: [{ rotate: chevronRotate }] }}>
          <MaterialCommunityIcons name="chevron-down" size={22} color={palette.muted} />
        </Animated.View>
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm }}>
          {children}
        </View>
      ) : null}
    </AppCard>
  );
}

/**
 * Animated container for tab content. Fades in when key changes so
 * SegmentedButtons feel like a real navigation instead of an instant swap.
 */
export function AnimatedTab({ tabKey, children }: { tabKey: string; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(6)).current;

  useEffect(() => {
    opacity.setValue(0);
    translate.setValue(6);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [tabKey, opacity, translate]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY: translate }] }}>{children}</Animated.View>
  );
}
