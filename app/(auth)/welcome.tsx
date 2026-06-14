import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewToken,
} from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Button, Text } from 'react-native-paper';
import { authColors as colors, spacing } from '../../lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Slide = {
  key: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  secondaryIcons: (keyof typeof MaterialCommunityIcons.glyphMap)[];
  title: string;
  description: string;
};

const slides: Slide[] = [
  {
    key: 'scheduling',
    icon: 'calendar-month',
    secondaryIcons: ['clock-outline', 'account-group'],
    title: 'Faster Scheduling',
    description: 'Build the work schedule in minutes.\nShare and track it instantly.',
  },
  {
    key: 'reservations',
    icon: 'book-open-variant',
    secondaryIcons: ['table-chair', 'bell-ring-outline'],
    title: 'Smarter Reservations',
    description: 'Manage bookings, walk-ins, and\nwaitlists all from one place.',
  },
  {
    key: 'crm',
    icon: 'account-heart-outline',
    secondaryIcons: ['chart-line', 'tag-multiple-outline'],
    title: 'Know Your Guests',
    description: 'Track preferences, visits, and spend\nto deliver a personal experience.',
  },
];

function AnimatedSlide({ item, index, scrollX }: { item: Slide; index: number; scrollX: Animated.Value }) {
  const inputRange = [(index - 1) * SCREEN_WIDTH, index * SCREEN_WIDTH, (index + 1) * SCREEN_WIDTH];

  const iconScale = scrollX.interpolate({
    inputRange,
    outputRange: [0.5, 1, 0.5],
    extrapolate: 'clamp',
  });
  const iconOpacity = scrollX.interpolate({
    inputRange,
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });
  const textTranslate = scrollX.interpolate({
    inputRange,
    outputRange: [40, 0, -40],
    extrapolate: 'clamp',
  });
  const textOpacity = scrollX.interpolate({
    inputRange,
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
      <Animated.View style={[styles.iconContainer, { transform: [{ scale: iconScale }], opacity: iconOpacity }]}>
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name={item.icon} size={80} color={colors.primary} />
        </View>
        <View style={styles.secondaryIcons}>
          {item.secondaryIcons.map((name, i) => (
            <View key={name} style={[styles.secondaryBadge, i === 0 ? { left: 0 } : { right: 0 }]}>
              <MaterialCommunityIcons name={name} size={28} color={colors.primary} />
            </View>
          ))}
        </View>
      </Animated.View>

      <Animated.View style={{ opacity: textOpacity, transform: [{ translateY: textTranslate }] }}>
        <Text variant="headlineSmall" style={styles.title}>{item.title}</Text>
        <Text variant="bodyLarge" style={styles.description}>{item.description}</Text>
      </Animated.View>
    </View>
  );
}

export default function WelcomeScreen() {
  const scrollX = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<Animated.FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const autoPlayRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      setActiveIndex(viewableItems[0].index);
    }
  }, []);

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  useEffect(() => {
    autoPlayRef.current = setInterval(() => {
      setActiveIndex((prev) => {
        const next = (prev + 1) % slides.length;
        flatListRef.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, 4000);
    return () => {
      if (autoPlayRef.current) clearInterval(autoPlayRef.current);
    };
  }, []);

  const stopAutoPlay = () => {
    if (autoPlayRef.current) {
      clearInterval(autoPlayRef.current);
      autoPlayRef.current = null;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoArea}>
        <Text variant="headlineLarge" style={styles.logo}>Venue Wrangler</Text>
      </View>

      <View style={{ flex: 1 }}>
        <Animated.FlatList
          ref={flatListRef}
          data={slides}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onScrollBeginDrag={stopAutoPlay}
          renderItem={({ item, index }) => <AnimatedSlide item={item} index={index} scrollX={scrollX} />}
          keyExtractor={(item) => item.key}
          getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
        />
      </View>

      <View style={styles.dotRow}>
        {slides.map((_, i) => (
          <Pressable
            key={i}
            onPress={() => {
              stopAutoPlay();
              flatListRef.current?.scrollToIndex({ index: i, animated: true });
            }}
          >
            <View style={[styles.dot, i === activeIndex && styles.dotActive]} />
          </Pressable>
        ))}
      </View>

      <View style={styles.buttonArea}>
        <Button
          mode="contained"
          buttonColor={colors.primary}
          textColor={colors.buttonText}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
          onPress={() => router.push({ pathname: '/(auth)/sign-in', params: { tab: 'signIn' } })}
        >
          Log In
        </Button>
        <Button
          mode="outlined"
          textColor={colors.primary}
          style={styles.signUpButton}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
          onPress={() => router.push({ pathname: '/(auth)/sign-in', params: { tab: 'signUp' } })}
        >
          Sign Up
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  logoArea: {
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 70 : 50,
    paddingBottom: spacing.md,
  },
  logo: {
    color: colors.primary,
    fontWeight: '800',
  },
  slide: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 200,
    height: 200,
  },
  iconCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#E5F1E7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryIcons: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  secondaryBadge: {
    position: 'absolute',
    top: 10,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E5F1E7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
  },
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D4CFC6',
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 24,
  },
  buttonArea: {
    paddingHorizontal: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    gap: 12,
  },
  buttonContent: {
    height: 52,
  },
  buttonLabel: {
    fontSize: 17,
    fontWeight: '700',
  },
  signUpButton: {
    borderColor: colors.border,
    borderWidth: 1,
  },
});
