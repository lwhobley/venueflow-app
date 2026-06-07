import { Image, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, useDesignTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import { DESKTOP_BREAKPOINT } from '../lib/responsive';

type TabRoute = BottomTabBarProps['state']['routes'][number];

export function CarouselTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const palette = useDesignTheme();
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;

  const visible = state.routes.filter((route: TabRoute) => {
    const opts = descriptors[route.key].options as { href?: string | null };
    return opts.href !== null;
  });

  return (
    <View
      style={{
        backgroundColor: palette.backgroundAlt,
        borderTopWidth: isDesktop ? 0 : 1,
        borderTopColor: palette.border,
        borderRightWidth: isDesktop ? 1 : 0,
        borderRightColor: palette.border,
        paddingBottom: isDesktop ? 18 : insets.bottom,
        paddingTop: isDesktop ? 18 : 0,
        width: isDesktop ? 248 : undefined,
        height: isDesktop ? '100%' : undefined,
        shadowColor: palette.shadow,
        shadowOpacity: palette.mode === 'dark' ? 0.2 : 0.08,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: isDesktop ? 0 : -8 },
      }}
    >
      {isDesktop ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 8, alignItems: 'center' }}>
          <Image source={require('../assets/venue-wrangler-logo.jpg')} resizeMode="contain" style={{ width: 208, height: 160 }} />
          <Text style={{ color: palette.muted, fontSize: 12, marginTop: -8, fontWeight: '700' }}>{t('common.venueWrangler')}</Text>
        </View>
      ) : null}
      <ScrollView
        horizontal={!isDesktop}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: isDesktop ? 12 : 10,
          alignItems: isDesktop ? 'stretch' : 'center',
          gap: isDesktop ? 8 : 0,
        }}
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
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              style={{
                minWidth: isDesktop ? undefined : 68,
                paddingVertical: isDesktop ? 12 : 7,
                paddingHorizontal: isDesktop ? 14 : 10,
                marginVertical: isDesktop ? 0 : 6,
                marginHorizontal: isDesktop ? 0 : 1,
                borderRadius: isDesktop ? radius.md : radius.pill,
                alignItems: 'center',
                flexDirection: isDesktop ? 'row' : 'column',
                gap: isDesktop ? 12 : 3,
                backgroundColor: isFocused ? (isDesktop ? palette.cream : palette.primary) : 'transparent',
                borderWidth: isDesktop ? 1 : 0,
                borderColor: isFocused ? palette.border : 'transparent',
              }}
            >
              {options.tabBarIcon?.({ focused: isFocused, color, size: 22 })}
              <Text numberOfLines={1} style={{ color, fontSize: isDesktop ? 14 : 11, fontWeight: isFocused ? '800' : '600' }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
        <View style={{ paddingHorizontal: 14, alignItems: isDesktop ? 'center' : 'flex-start', justifyContent: 'center', minHeight: 54 }}>
          <Text style={{ color: palette.muted, fontSize: 10, fontWeight: '700' }}>{t('common.venueWrangler')}</Text>
          <Text style={{ color: palette.muted, fontSize: 9 }}>{t('common.loungeability')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}
