import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

export default function TabsLayout() {
  const role = useAuthStore((state: AuthState) => state.user?.role ?? 'staff');
  const canManage = role === 'admin' || role === 'owner' || role === 'manager';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialCommunityIcons name="view-dashboard" size={size} color={color} /> }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialCommunityIcons name="calendar-week" size={size} color={color} /> }} />
      <Tabs.Screen name="floor" options={{ title: 'Floor', tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialCommunityIcons name="floor-plan" size={size} color={color} /> }} />
      <Tabs.Screen name="clock" options={{ title: 'Clock', tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialCommunityIcons name="clock-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="reservations" options={{ title: 'Reservations', tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialCommunityIcons name="book-clock-outline" size={size} color={color} /> }} />
      <Tabs.Screen
        name="staff"
        options={{
          title: 'Staff',
          href: canManage ? '/staff' : null,
          tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialCommunityIcons name="account-group" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Requests',
          href: canManage ? '/chat' : null,
          tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialCommunityIcons name="account-clock" size={size} color={color} />,
        }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialCommunityIcons name="account-circle" size={size} color={color} /> }} />
    </Tabs>
  );
}