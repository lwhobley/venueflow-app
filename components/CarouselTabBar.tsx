import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontFamily, useDesignTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';

type TabRoute = BottomTabBarProps['state']['routes'][number];

// Editorial tab bar: no filled pill indicator — the active tab is marked by
// a hairline underline and the accent color, like a masthead nav rather than
// a row of chips. Separated from content by a single top rule, not a shadow.
export function CarouselTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const palette = useDesignTheme();
  const { t } = useI18n();

  const visible = state.routes.filter((route: TabRoute) => {
    const opts = descriptors[route.key].options as { href?: string | null };
    return opts.href !== null;
  });

  return (
    <View
      style={{
        backgroundColor: palette.backgroundAlt,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.divider,
        paddingBottom: insets.bottom,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 14, alignItems: 'center' }}
      >
        {visible.map((route: TabRoute) => {
          const { options } = descriptors[route.key];
          const activeIndex = state.routes.findIndex((r: TabRoute) => r.key === route.key);
          const isFocused = state.index === activeIndex;
          const color = isFocused ? palette.primary : palette.muted;
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
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={isFocused ? { selected: true } : {}}
              style={{
                minWidth: 66,
                paddingTop: 9,
                paddingBottom: 7,
                paddingHorizontal: 8,
                marginHorizontal: 3,
                alignItems: 'center',
                gap: 3,
                borderBottomWidth: 2,
                borderBottomColor: isFocused ? palette.primary : 'transparent',
              }}
            >
              {options.tabBarIcon?.({ focused: isFocused, color, size: 21 })}
              <Text
                numberOfLines={1}
                style={{ color, fontSize: 10.5, fontWeight: isFocused ? '700' : '500', letterSpacing: 0.1 }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
        <View style={{ paddingHorizontal: 16, alignItems: 'flex-start', justifyContent: 'center', minHeight: 54 }}>
          <Text style={{ color: palette.charcoal, fontFamily: fontFamily.displayMedium, fontSize: 13 }}>
            {t('common.venueWrangler')}
          </Text>
          <Text style={{ color: palette.muted, fontSize: 9, fontStyle: 'italic' }}>{t('common.loungeability')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}
