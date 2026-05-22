import { Pressable, ScrollView, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';

// A horizontally scrollable ("carousel") bottom tab bar. Tabs whose route
// options set `href: null` are hidden (used to hide manager-only / staff-only
// tabs per role), matching expo-router's default behavior.
export function CarouselTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  const visible = state.routes.filter((route) => {
    const opts = descriptors[route.key].options as { href?: string | null };
    return opts.href !== null;
  });

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingBottom: insets.bottom,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 8, alignItems: 'center' }}
      >
        {visible.map((route) => {
          const { options } = descriptors[route.key];
          const activeIndex = state.routes.findIndex((r) => r.key === route.key);
          const isFocused = state.index === activeIndex;
          const color = isFocused ? colors.primary : colors.muted;
          const label = (options.title ?? route.name) as string;

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              style={{
                minWidth: 76,
                paddingVertical: 8,
                paddingHorizontal: 12,
                marginVertical: 6,
                marginHorizontal: 2,
                borderRadius: 14,
                alignItems: 'center',
                gap: 3,
                backgroundColor: isFocused ? colors.cream : 'transparent',
              }}
            >
              {options.tabBarIcon?.({ focused: isFocused, color, size: 22 })}
              <Text numberOfLines={1} style={{ color, fontSize: 11, fontWeight: isFocused ? '700' : '500' }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
