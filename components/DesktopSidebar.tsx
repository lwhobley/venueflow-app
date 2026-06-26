import { Pressable, ScrollView, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { radius, useDesignTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';

type TabRoute = BottomTabBarProps['state']['routes'][number];

export const SIDEBAR_WIDTH = 248;

/**
 * Left-rail navigation for the desktop web layout. Renders the same tab routes
 * as the mobile CarouselTabBar (respecting `href: null` to hide gated tabs) but
 * as a vertical sidebar. Positioned absolutely so it claims no bottom-bar space;
 * the screen content is offset by SIDEBAR_WIDTH via the navigator's
 * sceneContainerStyle.
 */
export function DesktopSidebar({ state, descriptors, navigation }: BottomTabBarProps) {
  const palette = useDesignTheme();
  const { t } = useI18n();

  // expo-router strips `href` from options and encodes `href: null` (a hidden
  // tab) as tabBarItemStyle.display === 'none'. Filter on that signal so
  // gated/hidden routes don't leak into the rail. (Visible href routes keep
  // their style untouched, so only hidden ones match.)
  const visible = state.routes.filter((route: TabRoute) => {
    const itemStyle = descriptors[route.key].options.tabBarItemStyle as { display?: string } | undefined;
    return itemStyle?.display !== 'none';
  });

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: SIDEBAR_WIDTH,
        backgroundColor: palette.backgroundAlt,
        borderRightWidth: 1,
        borderRightColor: palette.border,
      }}
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 16 }}>
        <Text style={{ color: palette.primary, fontSize: 20, fontWeight: '800' }}>
          {t('common.venueWrangler')}
        </Text>
        <Text style={{ color: palette.muted, fontSize: 11, marginTop: 2 }}>{t('common.loungeability')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24, gap: 2 }}>
        {visible.map((route: TabRoute) => {
          const { options } = descriptors[route.key];
          const activeIndex = state.routes.findIndex((r: TabRoute) => r.key === route.key);
          const isFocused = state.index === activeIndex;
          const color = isFocused ? palette.backgroundAlt : palette.charcoal;
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
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 11,
                paddingHorizontal: 14,
                borderRadius: radius.md,
                backgroundColor: isFocused ? palette.primary : 'transparent',
              }}
            >
              {options.tabBarIcon?.({ focused: isFocused, color, size: 22 })}
              <Text numberOfLines={1} style={{ color, fontSize: 14, fontWeight: isFocused ? '700' : '600' }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
