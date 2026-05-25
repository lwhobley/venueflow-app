import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { colors } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { CarouselTabBar } from '../../components/CarouselTabBar';

const icon = (name: keyof typeof MaterialCommunityIcons.glyphMap) =>
  ({ color, size }: { color: string; size: number }) => <MaterialCommunityIcons name={name} size={size} color={color} />;

export default function TabsLayout() {
  const storeRole = useAuthStore((state: AuthState) => state.user?.role ?? 'staff');
  const fullName = useAuthStore((state: AuthState) => state.user?.full_name ?? 'Profile');
  // Server-authoritative role so a stale/incorrect persisted role can never
  // expose manager-only tabs. While loading, fall back to the stored role;
  // if not authenticated, treat as staff (hide everything gated).
  const me = useQuery(api.app.getMe);
  const role = me === undefined ? storeRole : me?.profile.role ?? 'staff';
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
      <Tabs.Screen name="clock" options={{ title: 'Clock IN/OUT', tabBarIcon: icon('clock-outline') }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: icon('calendar-week') }} />
      <Tabs.Screen
        name="availability"
        options={{
          title: 'Availability',
          href: null,
          tabBarIcon: icon('calendar-check'),
        }}
      />
      <Tabs.Screen name="floor" options={{ title: 'Floor', tabBarIcon: icon('floor-plan') }} />
      <Tabs.Screen name="reservations" options={{ title: 'Reservations', tabBarIcon: icon('book-clock-outline') }} />
      <Tabs.Screen
        name="guests"
        options={{ title: 'Guests', href: null, tabBarIcon: icon('account-heart-outline') }}
      />
      <Tabs.Screen
        name="integrations"
        options={{ title: 'Integrations', href: null, tabBarIcon: icon('connection') }}
      />
      <Tabs.Screen
        name="chat"
        options={{ title: 'Chat', tabBarIcon: icon('chat-outline') }}
      />
      <Tabs.Screen
        name="bar-stock"
        options={{ title: 'Inventory', href: canManage ? '/bar-stock' : null, tabBarIcon: icon('glass-cocktail') }}
      />
      <Tabs.Screen
        name="reports"
        options={{ title: 'Reports', href: canManage ? '/reports' : null, tabBarIcon: icon('chart-box-outline') }}
      />
      <Tabs.Screen
        name="staff"
        options={{ title: 'Staff', href: canManage ? '/staff' : null, tabBarIcon: icon('account-group') }}
      />
      <Tabs.Screen name="profile" options={{ title: fullName, tabBarIcon: icon('account-circle') }} />
    </Tabs>
  );
}
