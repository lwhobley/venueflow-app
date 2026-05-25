import { Pressable, ScrollView, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, useDesignTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';

export function CarouselTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const palette = useDesignTheme();
  const { t } = useI18n();

  const visible = state.routes.filter((route) => {
    const opts = descriptors[route.key].options as { href?: string | null };
    return opts.href !== null;
  });

  return (
    <View
      style={{
        backgroundColor: palette.glass,
        borderTopWidth: 1,
        borderTopColor: palette.border,
        paddingBottom: insets.bottom,
        shadowColor: palette.primary,
        shadowOpacity: palette.mode === 'dark' ? 0.16 : 0.08,
        shadowRadius: 18,
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
                minWidth: 76,
                paddingVertical: 8,
                paddingHorizontal: 12,
                marginVertical: 6,
                marginHorizontal: 2,
                borderRadius: radius.md,
                alignItems: 'center',
                gap: 3,
                backgroundColor: isFocused ? palette.cream : 'transparent',
                borderWidth: 1,
                borderColor: isFocused ? palette.border : 'transparent',
              }}
            >
              {options.tabBarIcon?.({ focused: isFocused, color, size: 22 })}
              <Text numberOfLines={1} style={{ color, fontSize: 11, fontWeight: isFocused ? '800' : '600' }}>
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
