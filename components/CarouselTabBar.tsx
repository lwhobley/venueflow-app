import type { ComponentProps } from 'react';
import type { Tabs } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDesignTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import { DESKTOP_NAV_WIDTH, useIsDesktop } from '../lib/responsive';

type ExpoTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];
type TabRoute = ExpoTabBarProps['state']['routes'][number];

// Editorial tab bar: no filled pill indicator — the active tab is marked by
// a hairline underline and the accent color, like a masthead nav rather than
// a row of chips. Separated from content by a single top rule, not a shadow.
//
// At desktop-web widths the same items render as a persistent left rail
// instead. A fourteen-item horizontally-scrolling strip pinned to the bottom
// of a 1680px window is a phone affordance: the labels are unreadable at that
// distance and reaching the later tabs means scrolling a nav bar, which no
// desktop user expects.
export function CarouselTabBar({ state, descriptors, navigation }: ExpoTabBarProps) {
  const insets = useSafeAreaInsets();
  const palette = useDesignTheme();
  const { t } = useI18n();
  const isDesktop = useIsDesktop();

  const visible = state.routes.filter((route: TabRoute) => {
    const opts = descriptors[route.key].options as { href?: string | null };
    return opts.href !== null;
  });

  const items = visible.map((route: TabRoute) => {
    const { options } = descriptors[route.key];
    const activeIndex = state.routes.findIndex((r: TabRoute) => r.key === route.key);
    const isFocused = state.index === activeIndex;
    return {
      key: route.key,
      name: route.name,
      label: (options.title ?? route.name) as string,
      icon: options.tabBarIcon,
      isFocused,
      onPress: () => {
        const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
        if (!isFocused && !event.defaultPrevented) {
          navigation.navigate(route.name);
        }
      },
    };
  });

  const wordmark = (
    <View style={{ paddingHorizontal: 16, alignItems: 'flex-start', justifyContent: 'center', minHeight: 54 }}>
      <Text style={{ color: palette.charcoal, fontWeight: '700', fontSize: 13 }}>
        {t('common.venueWrangler')}
      </Text>
      <Text style={{ color: palette.muted, fontSize: 9, fontStyle: 'italic' }}>{t('common.loungeability')}</Text>
    </View>
  );

  if (isDesktop) {
    return (
      <View
        // Absolute rather than part of the navigator's flex row: expo-router's
        // bundled Tabs always renders the tabBar below the scene, and it has no
        // supported "left" placement. Screens reserve this width through
        // useDesktopContentStyle, so nothing renders underneath it.
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: DESKTOP_NAV_WIDTH,
          backgroundColor: palette.backgroundAlt,
          borderRightWidth: StyleSheet.hairlineWidth,
          borderRightColor: palette.divider,
          zIndex: 10,
        }}
      >
        {wordmark}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 8, paddingHorizontal: 10, gap: 2 }}
        >
          {items.map((item) => (
            <Pressable
              key={item.key}
              onPress={item.onPress}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={item.isFocused ? { selected: true } : {}}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 8,
                // A filled row reads as "selected" in a vertical list, where the
                // bottom-bar underline has nothing to sit against.
                backgroundColor: item.isFocused ? palette.background : 'transparent',
              }}
            >
              {item.icon?.({
                focused: item.isFocused,
                color: item.isFocused ? palette.primary : palette.muted,
                size: 20,
              })}
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  color: item.isFocused ? palette.primary : palette.charcoal,
                  fontSize: 13.5,
                  fontWeight: item.isFocused ? '700' : '500',
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  }

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
        {items.map((item) => {
          const color = item.isFocused ? palette.primary : palette.muted;
          return (
            <Pressable
              key={item.key}
              onPress={item.onPress}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={item.isFocused ? { selected: true } : {}}
              style={{
                minWidth: 66,
                paddingTop: 9,
                paddingBottom: 7,
                paddingHorizontal: 8,
                marginHorizontal: 3,
                alignItems: 'center',
                gap: 3,
                borderBottomWidth: 2,
                borderBottomColor: item.isFocused ? palette.primary : 'transparent',
              }}
            >
              {item.icon?.({ focused: item.isFocused, color, size: 21 })}
              <Text
                numberOfLines={1}
                style={{ color, fontSize: 10.5, fontWeight: item.isFocused ? '700' : '500', letterSpacing: 0.1 }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
        {wordmark}
      </ScrollView>
    </View>
  );
}
