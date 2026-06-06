import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useApiClient } from './api-client';
import { useAuthStore, type AuthState } from './auth-store';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function platformName(): 'ios' | 'android' | 'web' | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'web') return 'web';
  return null;
}

export function usePushNotifications() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const request = useApiClient();

  useEffect(() => {
    let cancelled = false;

    async function register() {
      if (!user || !venue || Platform.OS === 'web') return;
      const platform = platformName();
      if (!platform || platform === 'web') return;
      const permission = await Notifications.getPermissionsAsync();
      const finalPermission = permission.status === 'granted' ? permission : await Notifications.requestPermissionsAsync();
      if (cancelled || finalPermission.status !== 'granted') return;
      const token = await Notifications.getDevicePushTokenAsync();
      if (cancelled || !token.data) return;
      await request('POST', '/v1/push/tokens', { token: token.data, platform });
    }

    void register().catch((error) => {
      console.warn('Unable to register push notifications', error);
    });

    return () => {
      cancelled = true;
    };
  }, [request, user, venue]);
}
