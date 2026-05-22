import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { CarouselTabBar } from '../../components/CarouselTabBar';

const icon = (name: keyof typeof MaterialCommunityIcons.glyphMap) =>
  ({ color, size }: { color: string; size: number }) => <MaterialCommunityIcons name={name} size={size} color={color} />;

export default function TabsLayout() {
  const role = useAuthStore((state: AuthState) => state.user?.role ?? 'staff');
  const canManage = role === 'admin' || role === 'owner' || role === 'manager';

  return (
    <Tabs
      tabBar={(props) => <CarouselTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: icon('view-dashboard') }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: icon('calendar-week') }} />
      <Tabs.Screen
        name="availability"
        options={{
          title: 'Availability',
          href: canManage ? null : '/availability',
          tabBarIcon: icon('calendar-check'),
        }}
      />
      <Tabs.Screen name="floor" options={{ title: 'Floor', tabBarIcon: icon('floor-plan') }} />
      <Tabs.Screen name="clock" options={{ title: 'Clock', tabBarIcon: icon('clock-outline') }} />
      <Tabs.Screen name="reservations" options={{ title: 'Reservations', tabBarIcon: icon('book-clock-outline') }} />
      <Tabs.Screen
        name="staff"
        options={{ title: 'Staff', href: canManage ? '/staff' : null, tabBarIcon: icon('account-group') }}
      />
      <Tabs.Screen
        name="chat"
        options={{ title: 'Requests', href: canManage ? '/chat' : null, tabBarIcon: icon('account-clock') }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('account-circle') }} />
    </Tabs>
  );
}
