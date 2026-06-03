import { Pressable, ScrollView, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, useDesignTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';

type TabRoute = BottomTabBarProps['state']['routes'][number];

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
        borderTopWidth: 0,
        paddingBottom: insets.bottom,
        shadowColor: palette.shadow,
        shadowOpacity: palette.mode === 'dark' ? 0.2 : 0.08,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: -8 },
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 10, alignItems: 'center' }}
      >
        {visible.map((route: TabRoute) => {
          const { options } = descriptors[route.key];
          const activeIndex = state.routes.findIndex((r: TabRoute) => r.key === route.key);
          const isFocused = state.index === activeIndex;
          const color = isFocused ? palette.backgroundAlt : palette.muted;
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
                minWidth: 68,
                paddingVertical: 7,
                paddingHorizontal: 10,
                marginVertical: 6,
                marginHorizontal: 1,
                borderRadius: radius.pill,
                alignItems: 'center',
                gap: 3,
                backgroundColor: isFocused ? palette.primary : 'transparent',
              }}
            >
              {options.tabBarIcon?.({ focused: isFocused, color, size: 22 })}
              <Text numberOfLines={1} style={{ color, fontSize: 11, fontWeight: isFocused ? '700' : '600' }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
        <View style={{ paddingHorizontal: 14, alignItems: 'flex-start', justifyContent: 'center', minHeight: 54 }}>
          <Text style={{ color: palette.muted, fontSize: 10, fontWeight: '700' }}>{t('common.venueWrangler')}</Text>
          <Text style={{ color: palette.muted, fontSize: 9 }}>{t('common.loungeability')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}
