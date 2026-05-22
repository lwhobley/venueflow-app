import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useMutation } from 'convex/react';
import { api } from '../convex/_generated/api';
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

function platformName() {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'web') return 'web';
  return 'unknown';
}

export function usePushNotifications() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const registerPushToken = useMutation(api.push.registerPushToken);

  useEffect(() => {
    let cancelled = false;

    async function register() {
      if (!user || !venue || Platform.OS === 'web') return;
      const permission = await Notifications.getPermissionsAsync();
      const finalPermission = permission.status === 'granted' ? permission : await Notifications.requestPermissionsAsync();
      if (cancelled || finalPermission.status !== 'granted') return;
      const token = await Notifications.getDevicePushTokenAsync();
      if (cancelled || !token.data) return;
      await registerPushToken({ token: token.data, platform: platformName() });
    }

    void register().catch((error) => {
      console.warn('Unable to register push notifications', error);
    });

    return () => {
      cancelled = true;
    };
  }, [registerPushToken, user, venue]);
}
