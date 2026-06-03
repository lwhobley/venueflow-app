import { Tabs } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { ColorValue } from "react-native";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useDesignTheme } from "../../lib/theme";
import { useAuthStore, type AuthState } from "../../lib/auth-store";
import { CarouselTabBar } from "../../components/CarouselTabBar";
import { useI18n } from "../../lib/i18n";
import { canManageVenue } from "../../lib/permissions";
import { useAuthenticatedSession } from "../../lib/auth-readiness";

const icon =
  (name: keyof typeof MaterialCommunityIcons.glyphMap) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <MaterialCommunityIcons name={name} size={size} color={color} />
  );

export default function TabsLayout() {
  const localUser = useAuthStore((state: AuthState) => state.user);
  const fullName = localUser?.full_name ?? "Profile";
  const { t } = useI18n();
  const palette = useDesignTheme();
  // Server-authoritative role so a stale/incorrect persisted role can never
  // expose manager-only tabs. While loading, hide gated tabs.
  const { isReady } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : "skip");
  const role = me?.profile.role ?? null;
  const canManage = canManageVenue(
    role ?? localUser?.role,
    me?.profile.allAccess ?? localUser?.all_access,
  );

  return (
    <Tabs
      tabBar={(props) => <CarouselTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.muted,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: t("nav.home"), tabBarIcon: icon("view-dashboard") }}
      />
      <Tabs.Screen
        name="clock"
        options={{ title: t("nav.clock"), tabBarIcon: icon("clock-outline") }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: t("nav.schedule"),
          tabBarIcon: icon("calendar-week"),
        }}
      />
      <Tabs.Screen
        name="availability"
        options={{
          title: t("nav.availability"),
          href: null,
          tabBarIcon: icon("calendar-check"),
        }}
      />
      <Tabs.Screen
        name="floor"
        options={{ title: t("nav.floor"), tabBarIcon: icon("floor-plan") }}
      />
      <Tabs.Screen
        name="reservations"
        options={{
          title: t("nav.reservations"),
          tabBarIcon: icon("book-clock-outline"),
        }}
      />
      <Tabs.Screen
        name="guests"
        options={{
          title: t("nav.guests"),
          href: null,
          tabBarIcon: icon("account-heart-outline"),
        }}
      />
      <Tabs.Screen
        name="integrations"
        options={{
          title: t("nav.integrations"),
          href: null,
          tabBarIcon: icon("connection"),
        }}
      />
      <Tabs.Screen
        name="sales"
        options={{
          title: t("nav.sales"),
          href: canManage ? "/sales" : null,
          tabBarIcon: icon("chart-line"),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{ title: t("nav.chat"), tabBarIcon: icon("chat-outline") }}
      />
      <Tabs.Screen
        name="bar-stock"
        options={{
          title: t("nav.inventory"),
          href: canManage ? "/bar-stock" : null,
          tabBarIcon: icon("glass-cocktail"),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: t("nav.reports"),
          href: canManage ? "/reports" : null,
          tabBarIcon: icon("chart-box-outline"),
        }}
      />
      <Tabs.Screen
        name="staff"
        options={{
          title: t("nav.staff"),
          href: canManage ? "/staff" : null,
          tabBarIcon: icon("account-group"),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: fullName || t("nav.profileFallback"),
          tabBarIcon: icon("account-circle"),
        }}
      />
    </Tabs>
  );
}
